import { type DbClient, prisma } from "../domain-db";
import { enqueueAsOfRewrite } from "./asOfRewriteQueue";
import { remirrorCreditPoolAfterPolicyMutation } from "./parentCustomerCreditInheritance";
import { customerPolicySupersedeUpdateData } from "./customerPolicySupersede";
import { freezeCustomerPolicyGapOnDeactivation } from "./syncCustomerPolicyGapAmounts";
import { syncCustomerInsuranceFields } from "./syncCustomerInsuranceFields";
import { ensureCustomerCapacityGapStored } from "./syncCreditInsuranceGapPipeline";
import { startOfTodayUtc } from "./shared/insurancePolicyLifecycle";
import { applyDatedCustomerPolicyUnassign } from "./datedCustomerPolicyUnassign";

export type ActivateDuePendingCustomerPoliciesResult = {
    activated: number;
    rewriteEnqueued: number;
    failures: number;
};

export type ActivateDuePendingCustomerPoliciesOptions = {
    dbClient?: DbClient;
    applyDatedCustomerPolicyUnassign?: typeof applyDatedCustomerPolicyUnassign;
};

/**
 * Activate CustomerPolicy rows with status=pending whose policy_change_start_date is
 * on or before UTC today. Intended to run in the CPT daily cron **before**
 * today's tip and as-of rewrite drain so the tip sees the new active row.
 *
 * Pending unassign (null insurance_policy_id) uses the same dated-unassign apply
 * as immediate Remove, then leaves the pending row inactive — never an active
 * null-policy assignment. Ordinary pending policy rows still activate-to-active.
 */
export async function activateDuePendingCustomerPolicies(
    options?: ActivateDuePendingCustomerPoliciesOptions
): Promise<ActivateDuePendingCustomerPoliciesResult> {
    const db = options?.dbClient ?? prisma;
    const applyUnassign =
        options?.applyDatedCustomerPolicyUnassign ??
        applyDatedCustomerPolicyUnassign;
    const todayUtc = startOfTodayUtc();

    const duePending = await db.customerPolicy.findMany({
        where: {
            status: "pending",
            policy_change_start_date: { lte: todayUtc },
        },
        select: {
            id: true,
            customer_id: true,
            insurance_policy_id: true,
            policy_change_start_date: true,
            created_by: true,
            modified_by: true,
            Customer: { select: { account_id: true } },
        },
        orderBy: [{ policy_change_start_date: "asc" }, { id: "asc" }],
    });

    let activated = 0;
    let rewriteEnqueued = 0;
    let failures = 0;

    for (const pending of duePending) {
        const accountId = pending.Customer.account_id;
        try {
            if (pending.insurance_policy_id == null) {
                await applyUnassign({
                    customerId: pending.customer_id,
                    accountId,
                    userId:
                        pending.modified_by ?? pending.created_by ?? "system",
                    unassignDate: pending.policy_change_start_date,
                    dbClient: db,
                    activatingPendingId: pending.id,
                });
                activated += 1;
                rewriteEnqueued += 1;
                continue;
            }

            const activeRow = await db.customerPolicy.findFirst({
                where: {
                    customer_id: pending.customer_id,
                    status: "active",
                },
                select: { id: true },
            });

            if (activeRow) {
                await freezeCustomerPolicyGapOnDeactivation(
                    pending.customer_id,
                    activeRow.id,
                    db
                );
            }

            await db.$transaction(async (tx) => {
                if (activeRow) {
                    await tx.customerPolicy.updateMany({
                        where: {
                            customer_id: pending.customer_id,
                            status: "active",
                        },
                        data: customerPolicySupersedeUpdateData({
                            nextVersionStartDate:
                                pending.policy_change_start_date,
                            modifiedBy:
                                pending.modified_by ??
                                pending.created_by ??
                                "system",
                        }),
                    });
                }
                await tx.customerPolicy.update({
                    where: { id: pending.id },
                    data: {
                        status: "active",
                        is_active: true,
                    },
                });
            });

            try {
                await syncCustomerInsuranceFields(pending.customer_id, {
                    dbClient: db,
                    validateZeroLimitDate: false,
                });
                await ensureCustomerCapacityGapStored(pending.customer_id);
            } catch {
                // Tip/drain still see the active CustomerPolicy row; live sync
                // can catch up on next customer touch.
            }

            await enqueueAsOfRewrite({
                accountId,
                customerIds: [pending.customer_id],
                fromDate: pending.policy_change_start_date,
                toDate: new Date(),
            });
            try {
                await remirrorCreditPoolAfterPolicyMutation(
                    pending.customer_id,
                    accountId,
                    { dbClient: db }
                );
            } catch {
                // Pool remirror can catch up on next root policy touch.
            }
            activated += 1;
            rewriteEnqueued += 1;
        } catch {
            failures += 1;
        }
    }

    return { activated, rewriteEnqueued, failures };
}
