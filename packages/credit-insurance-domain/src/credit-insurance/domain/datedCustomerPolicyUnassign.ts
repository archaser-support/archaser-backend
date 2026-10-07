import { type DbClient, prisma } from "../domain-db";
import { rewriteCustomerAsOfRange } from "./asOfRewriteQueue";
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

/** Clear TF1 from invoices issued on or after the unassign day and refresh terms stamps. */
export async function stripInvoicePolicyStampsFromUnassignDay(
    customerId: number,
    insurancePolicyId: number,
    unassignDate: Date,
    options?: { dbClient?: DbClient; refreshTermsFlags?: boolean }
): Promise<number> {
    const db = options?.dbClient ?? prisma;
    const unassignDay = toUtcDateOnly(unassignDate);
    const result = await db.invoice.updateMany({
        where: {
            customer_id: customerId,
            policy_id: insurancePolicyId,
            invoice_date: { gte: unassignDay },
        },
        data: { policy_id: null },
    });
    if (options?.refreshTermsFlags !== false) {
        await refreshTermsBreachFlagsForCustomer(customerId, db);
    }
    return result.count;
}

async function endCustomerPolicyVersionsForUnassign(args: {
    customerId: number;
    insurancePolicyId: number;
    unassignDate: Date;
    userId: string;
    dbClient: DbClient;
    freezeActiveRowId?: number | null;
    freezeCustomerPolicyGapOnDeactivation?: typeof freezeCustomerPolicyGapOnDeactivation;
}): Promise<void> {
    if (args.freezeActiveRowId != null) {
        await (args.freezeCustomerPolicyGapOnDeactivation ??
            freezeCustomerPolicyGapOnDeactivation)(
            args.customerId,
            args.freezeActiveRowId,
            args.dbClient
        );
    }
    const unassignDay = toUtcDateOnly(args.unassignDate);
    const rows = await args.dbClient.customerPolicy.findMany({
        where: {
            customer_id: args.customerId,
            insurance_policy_id: args.insurancePolicyId,
        },
        select: {
            id: true,
            status: true,
            policy_change_start_date: true,
        },
    });
    for (const row of rows) {
        if (row.status === "pending") {
            continue;
        }
        const versionStart = toUtcDateOnly(row.policy_change_start_date);
        await args.dbClient.customerPolicy.update({
            where: { id: row.id },
            data: {
                ...(versionStart.getTime() < unassignDay.getTime()
                    ? { policy_change_end_date: unassignDay }
                    : {}),
                is_active: false,
                status: "inactive",
                modified_by: args.userId,
            },
        });
    }
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
    remirrorCreditPoolAfterPolicyMutation?: typeof remirrorCreditPoolAfterPolicyMutation;
    freezeCustomerPolicyGapOnDeactivation?: typeof freezeCustomerPolicyGapOnDeactivation;
    refreshTermsFlags?: boolean;
    /** When activating a due pending unassign, skip that row's pending conflict. */
    activatingPendingId?: number;
}): Promise<{ customerPolicyId: number }> {
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
        return { customerPolicyId: created.id };
    }

    const insurancePolicyId = activeRow.insurance_policy_id;

    await endCustomerPolicyVersionsForUnassign({
        customerId: args.customerId,
        insurancePolicyId,
        unassignDate: unassignDay,
        userId: args.userId,
        dbClient: db,
        freezeActiveRowId: activeRow.id,
        freezeCustomerPolicyGapOnDeactivation:
            args.freezeCustomerPolicyGapOnDeactivation,
    });
    await applyRunOffSideEffects({
        customerId: args.customerId,
        insurancePolicyId,
        unassignDate: unassignDay,
        userId: args.userId,
        dbClient: db,
        refreshTermsFlags: args.refreshTermsFlags,
    });

    if (args.activatingPendingId != null) {
        await db.customerPolicy.update({
            where: { id: args.activatingPendingId },
            data: {
                status: "inactive",
                is_active: false,
                modified_by: args.userId,
            },
        });
    }

    const remirror = await remirrorFn(args.customerId, args.accountId, {
        dbClient: db,
        userId: args.userId,
    });

    const rewriteCustomerIds = [
        args.customerId,
        ...remirror.mirroredCustomerIds,
    ];
    for (const descendantId of remirror.mirroredCustomerIds) {
        await endCustomerPolicyVersionsForUnassign({
            customerId: descendantId,
            insurancePolicyId,
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

    return { customerPolicyId: activeRow.id };
}
