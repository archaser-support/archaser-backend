import { type DbClient, prisma } from "../domain-db";
import { enqueueAsOfRewrite, rewriteCustomerAsOfRange } from "./asOfRewriteQueue";
import {
    isLinkedCreditChild,
    remirrorCreditPoolAfterPolicyMutation,
} from "./parentCustomerCreditInheritance";
import { startOfTodayUtc, toUtcDateOnly } from "./shared/insurancePolicyLifecycle";
import { freezeCustomerPolicyGapOnDeactivation } from "./syncCustomerPolicyGapAmounts";
import { ensureCustomerCapacityGapStored } from "./syncCreditInsuranceGapPipeline";
import { syncCustomerInsuranceFields } from "./syncCustomerInsuranceFields";
import { refreshTermsBreachFlagsForCustomer } from "./syncInvoiceReportingBreach";

export class DatedCustomerPolicyUnassignError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = "DatedCustomerPolicyUnassignError";
        this.code = code;
    }
}

function addUtcCalendarDays(value: Date, days: number): Date {
    const date = toUtcDateOnly(value);
    return new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate() + days
        )
    );
}

/** Clip/cancel this customer's live top-ups from the unassign day (do not cancel overlapping from original start). */
export async function clipCustomerTopUpsFromUnassignDay(
    customerId: number,
    unassignDate: Date,
    options?: { dbClient?: DbClient; userId?: string | null; now?: Date }
): Promise<void> {
    const db = options?.dbClient ?? prisma;
    const unassignDay = toUtcDateOnly(unassignDate);
    const lastTopUpDay = addUtcCalendarDays(unassignDay, -1);
    const now = options?.now ?? new Date();
    const rows = await db.customerTopUp.findMany({
        where: { customer_id: customerId, cancelled_at: null },
        select: { id: true, start_date: true, end_date: true },
    });

    for (const row of rows) {
        const start = toUtcDateOnly(row.start_date);
        const end = toUtcDateOnly(row.end_date);
        if (start.getTime() >= unassignDay.getTime()) {
            await db.customerTopUp.update({
                where: { id: row.id },
                data: {
                    cancelled_at: now,
                    ...(options?.userId ? { modified_by: options.userId } : {}),
                },
            });
            continue;
        }
        if (end.getTime() >= unassignDay.getTime()) {
            await db.customerTopUp.update({
                where: { id: row.id },
                data: {
                    end_date: lastTopUpDay,
                    ...(options?.userId ? { modified_by: options.userId } : {}),
                },
            });
        }
    }
}

/**
 * Clear TF1 from invoices no longer covered after a Remove and refresh terms
 * stamps: issued on or after the unassign day, or before the customer's first
 * TF1 version (no prehistory coverage once removed).
 */
export async function stripInvoicePolicyStampsFromUnassignDay(
    customerId: number,
    insurancePolicyId: number,
    unassignDate: Date,
    options?: { dbClient?: DbClient; refreshTermsFlags?: boolean }
): Promise<number> {
    const db = options?.dbClient ?? prisma;
    const unassignDay = toUtcDateOnly(unassignDate);
    const firstVersion = await db.customerPolicy.findFirst({
        where: {
            customer_id: customerId,
            insurance_policy_id: insurancePolicyId,
            status: { not: "pending" },
        },
        orderBy: [{ policy_change_start_date: "asc" }, { id: "asc" }],
        select: { policy_change_start_date: true },
    });
    const firstVersionStart =
        firstVersion != null
            ? toUtcDateOnly(firstVersion.policy_change_start_date)
            : null;
    const result = await db.invoice.updateMany({
        where: {
            customer_id: customerId,
            policy_id: insurancePolicyId,
            OR: [
                { invoice_date: { gte: unassignDay } },
                ...(firstVersionStart != null
                    ? [{ invoice_date: { lt: firstVersionStart } }]
                    : []),
            ],
        },
        data: { policy_id: null },
    });
    if (options?.refreshTermsFlags !== false) {
        await refreshTermsBreachFlagsForCustomer(customerId, db);
    }
    return result.count;
}

/**
 * Save the Remove: one Removed row (no policy, inactive, open end) starting on
 * the unassign day. Older versions are not written, so their dates and
 * modified at / by stay as they were; the as-of rules stop them at this row.
 */
async function createCustomerPolicyRemovedRow(args: {
    customerId: number;
    unassignDate: Date;
    userId: string;
    dbClient: DbClient;
}): Promise<number> {
    const created = await args.dbClient.customerPolicy.create({
        data: {
            customer_id: args.customerId,
            insurance_policy_id: null,
            policy_change_start_date: toUtcDateOnly(args.unassignDate),
            status: "inactive",
            is_active: false,
            created_by: args.userId,
            modified_by: args.userId,
        },
        select: { id: true },
    });
    return created.id;
}

async function applyRunOffSideEffects(args: {
    customerId: number;
    insurancePolicyId: number;
    unassignDate: Date;
    userId: string;
    dbClient: DbClient;
    refreshTermsFlags?: boolean;
}): Promise<void> {
    await clipCustomerTopUpsFromUnassignDay(args.customerId, args.unassignDate, {
        dbClient: args.dbClient,
        userId: args.userId,
    });
    await stripInvoicePolicyStampsFromUnassignDay(
        args.customerId,
        args.insurancePolicyId,
        args.unassignDate,
        {
            dbClient: args.dbClient,
            refreshTermsFlags: args.refreshTermsFlags,
        }
    );
    try {
        await syncCustomerInsuranceFields(args.customerId, {
            dbClient: args.dbClient,
            validateZeroLimitDate: false,
        });
        await ensureCustomerCapacityGapStored(args.customerId);
    } catch {
        // Live insurance fields can catch up on next customer touch.
    }
}


/**
 * Dated unassign: past/today applies run-off immediately; a future day creates
 * one pending null-policy row (no clip/strip/rewrite until activation).
 */
export async function applyDatedCustomerPolicyUnassign(args: {
    customerId: number;
    accountId: number;
    userId: string;
    unassignDate: Date | string | null;
    dbClient?: DbClient;
    rewriteCustomerAsOfRange?: typeof rewriteCustomerAsOfRange;
    enqueueAsOfRewrite?: typeof enqueueAsOfRewrite;
    remirrorCreditPoolAfterPolicyMutation?: typeof remirrorCreditPoolAfterPolicyMutation;
    freezeCustomerPolicyGapOnDeactivation?: typeof freezeCustomerPolicyGapOnDeactivation;
    refreshTermsFlags?: boolean;
    /** When activating a due pending unassign, skip that row's pending conflict. */
    activatingPendingId?: number;
}): Promise<{ customerPolicyId: number; rewriteEnqueued: boolean }> {
    const db = args.dbClient ?? prisma;

    if (await isLinkedCreditChild(args.customerId, db)) {
        throw new DatedCustomerPolicyUnassignError(
            "LINKED_CHILD_POLICY_LOCKED",
            "Customer policy can only be edited on the credit pool root"
        );
    }

    const pending = await db.customerPolicy.findFirst({
        where: { customer_id: args.customerId, status: "pending" },
        select: { id: true },
    });
    if (
        pending &&
        (args.activatingPendingId == null ||
            pending.id !== args.activatingPendingId)
    ) {
        throw new DatedCustomerPolicyUnassignError(
            "PENDING_POLICY_CHANGE_EXISTS",
            "A pending policy change exists. Cancel it before making further Policies changes."
        );
    }

    if (args.unassignDate == null || args.unassignDate === "") {
        throw new DatedCustomerPolicyUnassignError(
            "UNASSIGN_DATE_REQUIRED",
            "unassign_date is required"
        );
    }
    const unassignDay = toUtcDateOnly(args.unassignDate);
    const todayUtc = startOfTodayUtc();

    const activeRow = await db.customerPolicy.findFirst({
        where: { customer_id: args.customerId, is_active: true },
    });
    if (activeRow == null || activeRow.insurance_policy_id == null) {
        throw new DatedCustomerPolicyUnassignError(
            "NO_ACTIVE_POLICY",
            "Customer has no active insurance policy to remove"
        );
    }

    const product = await db.insurancePolicy.findUnique({
        where: { id: activeRow.insurance_policy_id },
        select: { start_date: true },
    });
    if (product?.start_date != null) {
        const productStart = toUtcDateOnly(product.start_date);
        if (unassignDay.getTime() < productStart.getTime()) {
            throw new DatedCustomerPolicyUnassignError(
                "UNASSIGN_DATE_BEFORE_POLICY_START",
                "unassign_date must be on or after this insurance policy start date"
            );
        }
    }

    const remirrorFn =
        args.remirrorCreditPoolAfterPolicyMutation ??
        remirrorCreditPoolAfterPolicyMutation;

    if (
        unassignDay.getTime() > todayUtc.getTime() &&
        args.activatingPendingId == null
    ) {
        const created = await db.customerPolicy.create({
            data: {
                customer_id: args.customerId,
                insurance_policy_id: null,
                policy_change_start_date: unassignDay,
                status: "pending",
                is_active: false,
                created_by: args.userId,
                modified_by: args.userId,
            },
        });
        await remirrorFn(args.customerId, args.accountId, {
            dbClient: db,
            userId: args.userId,
        });
        return { customerPolicyId: created.id, rewriteEnqueued: false };
    }

    const insurancePolicyId = activeRow.insurance_policy_id;

    await (args.freezeCustomerPolicyGapOnDeactivation ??
        freezeCustomerPolicyGapOnDeactivation)(args.customerId, activeRow.id, db);
    await db.customerPolicy.update({
        where: { id: activeRow.id },
        data: {
            is_active: false,
            status: "inactive",
            modified_by: args.userId,
        },
    });
    // A due pending unassign already is the Removed row (same shape).
    if (args.activatingPendingId != null) {
        await db.customerPolicy.update({
            where: { id: args.activatingPendingId },
            data: {
                status: "inactive",
                is_active: false,
                modified_by: args.userId,
            },
        });
    } else {
        await createCustomerPolicyRemovedRow({
            customerId: args.customerId,
            unassignDate: unassignDay,
            userId: args.userId,
            dbClient: db,
        });
    }
    await applyRunOffSideEffects({
        customerId: args.customerId,
        insurancePolicyId,
        unassignDate: unassignDay,
        userId: args.userId,
        dbClient: db,
        refreshTermsFlags: args.refreshTermsFlags,
    });

    const remirror = await remirrorFn(args.customerId, args.accountId, {
        dbClient: db,
        userId: args.userId,
    });

    const rewriteCustomerIds = [
        args.customerId,
        ...remirror.mirroredCustomerIds,
    ];
    for (const descendantId of remirror.mirroredCustomerIds) {
        await createCustomerPolicyRemovedRow({
            customerId: descendantId,
            unassignDate: unassignDay,
            userId: args.userId,
            dbClient: db,
        });
        await applyRunOffSideEffects({
            customerId: descendantId,
            insurancePolicyId,
            unassignDate: unassignDay,
            userId: args.userId,
            dbClient: db,
            refreshTermsFlags: args.refreshTermsFlags,
        });
    }

    const rewriteInput = {
        accountId: args.accountId,
        customerIds: rewriteCustomerIds,
        fromDate: unassignDay,
        toDate: new Date(),
    };

    // Run-off is already written; a failed enqueue must not fail the Remove
    // or the pending activation (neither would retry it).
    let rewriteEnqueued = false;
    try {
        await (args.enqueueAsOfRewrite ?? enqueueAsOfRewrite)(
            rewriteInput,
            db
        );
        rewriteEnqueued = true;
    } catch (error) {
        console.error(
            "[datedCustomerPolicyUnassign] dashboard rewrite enqueue failed after unassign",
            {
                accountId: args.accountId,
                customerId: args.customerId,
                fromDate: unassignDay.toISOString().slice(0, 10),
                errorMessage:
                    error instanceof Error ? error.message : String(error),
            }
        );
    }
    const rewriteOptions = {
        dbClient: db,
        preserveHistoryBeforeFromDate: true as const,
    };
    if (args.rewriteCustomerAsOfRange) {
        await args.rewriteCustomerAsOfRange(rewriteInput, rewriteOptions);
    } else {
        // Do not block Remove on the full as-of window (can exceed the browser
        // timeout). Tests inject rewriteCustomerAsOfRange and still await it.
        void rewriteCustomerAsOfRange(rewriteInput, rewriteOptions).catch(
            (error: unknown) => {
                console.error(
                    "[datedCustomerPolicyUnassign] CPT rewrite failed after unassign",
                    error
                );
            }
        );
    }

    return { customerPolicyId: activeRow.id, rewriteEnqueued };
}
