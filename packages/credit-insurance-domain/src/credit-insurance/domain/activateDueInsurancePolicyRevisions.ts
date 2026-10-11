import type { InsurancePolicy, Prisma } from "@prisma/client";
import { type DbClient, prisma } from "../domain-db";
import {
    applyInsurancePolicyUpdateWithCustomerPush,
    CLEARED_INSURANCE_POLICY_PENDING_REVISION,
    enqueueInsurancePolicyUpdateAsOfRewrite,
    INSURANCE_POLICY_PUSH_TRANSACTION_TIMEOUT_MS,
    InsurancePolicyUpdateDataError,
    prepareInsurancePolicyUpdateData,
    toInsuranceEntityUpdateData,
    type ApplyInsurancePolicyUpdateResult,
} from "./insurancePolicyUpdate";
import { startOfTodayUtc } from "./shared/insurancePolicyLifecycle";

export type ActivateDueInsurancePolicyRevisionsResult = {
    /** Due pending revisions found at job start. */
    processed: number;
    /** Snapshot applied, pending cleared, customers pushed (committed). */
    activated: number;
    /** No longer due when re-read in the transaction (e.g. cancelled meanwhile). */
    skipped: number;
    /** Apply failed and rolled back; pending kept for the next run. */
    failures: number;
    /** Activated but the post-commit as-of rewrite enqueue failed. */
    rewriteEnqueueFailures: number;
    customersVersioned: number;
};

export type ActivatedInsurancePolicyRevision = ApplyInsurancePolicyUpdateResult & {
    policyBefore: InsurancePolicy;
};

export type ActivateDueInsurancePolicyRevisionsOptions = {
    dbClient?: DbClient;
    todayUtc?: Date;
};

/**
 * Apply one due pending revision inside `tx`: the stored PUT snapshot goes
 * through the same preparation + apply/push path as a today-confirm save, and
 * the pending columns are cleared in the same policy update. Returns null when
 * the policy no longer has a due pending revision.
 */
export async function activateInsurancePolicyRevisionInTransaction(
    tx: Prisma.TransactionClient,
    policyId: number,
    todayUtc: Date
): Promise<ActivatedInsurancePolicyRevision | null> {
    const policyBefore = await tx.insurancePolicy.findFirst({
        where: { id: policyId, pending_effective_date: { lte: todayUtc } },
    });
    if (!policyBefore?.pending_effective_date) {
        return null;
    }
    const payload = policyBefore.pending_payload;
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
        throw new InsurancePolicyUpdateDataError(
            "pending_payload must be a JSON object"
        );
    }
    const data = toInsuranceEntityUpdateData(
        payload as Record<string, unknown>
    );
    prepareInsurancePolicyUpdateData(policyBefore, data);
    const applied = await applyInsurancePolicyUpdateWithCustomerPush({
        tx,
        accountId: policyBefore.account_id,
        policyBefore,
        data: { ...data, ...CLEARED_INSURANCE_POLICY_PENDING_REVISION },
        userId: policyBefore.pending_created_by ?? "system",
        customerVersionStartDate: policyBefore.pending_effective_date,
    });
    return { ...applied, policyBefore };
}

/**
 * Activate Insurance Policies whose pending revision is due (pending_effective_date
 * on or before UTC today), across all accounts. Each policy runs in its own
 * transaction; one failure is logged and counted without stopping the rest.
 */
export async function activateDueInsurancePolicyRevisions(
    options?: ActivateDueInsurancePolicyRevisionsOptions
): Promise<ActivateDueInsurancePolicyRevisionsResult> {
    const db = options?.dbClient ?? prisma;
    const todayUtc = startOfTodayUtc(options?.todayUtc);

    const due = await db.insurancePolicy.findMany({
        where: { pending_effective_date: { lte: todayUtc } },
        select: { id: true, account_id: true },
        orderBy: [{ pending_effective_date: "asc" }, { id: "asc" }],
    });

    const result: ActivateDueInsurancePolicyRevisionsResult = {
        processed: due.length,
        activated: 0,
        skipped: 0,
        failures: 0,
        rewriteEnqueueFailures: 0,
        customersVersioned: 0,
    };

    for (const { id: policyId, account_id: accountId } of due) {
        let activated: ActivatedInsurancePolicyRevision | null;
        try {
            activated = await db.$transaction(
                (tx) =>
                    activateInsurancePolicyRevisionInTransaction(
                        tx,
                        policyId,
                        todayUtc
                    ),
                { timeout: INSURANCE_POLICY_PUSH_TRANSACTION_TIMEOUT_MS }
            );
        } catch (error) {
            result.failures += 1;
            console.error(
                "[activateDueInsurancePolicyRevisions] Activation failed; pending revision kept:",
                {
                    policyId,
                    accountId,
                    errorName: error instanceof Error ? error.name : null,
                    errorMessage:
                        error instanceof Error ? error.message : String(error),
                }
            );
            continue;
        }
        if (!activated) {
            result.skipped += 1;
            continue;
        }
        result.activated += 1;
        result.customersVersioned += activated.versionedCustomerIds.length;

        try {
            await enqueueInsurancePolicyUpdateAsOfRewrite({
                accountId,
                before: activated.policyBefore,
                after: activated.policy,
            });
        } catch (error) {
            result.rewriteEnqueueFailures += 1;
            console.error(
                "[activateDueInsurancePolicyRevisions] Activated but as-of rewrite enqueue failed:",
                {
                    policyId,
                    accountId,
                    errorMessage:
                        error instanceof Error ? error.message : String(error),
                }
            );
        }
    }

    return result;
}
