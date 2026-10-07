import { type DbClient, prisma as defaultPrisma } from "../domain-db";

export type CreditSnapshotScopeArgs = {
    accountId: number;
    customerId?: number | null;
    customerIds?: number[];
    dbClient?: DbClient;
};

function resolveCustomerIds(
    args: CreditSnapshotScopeArgs
): number[] | undefined {
    if (args.customerIds != null && args.customerIds.length > 0) {
        return args.customerIds.filter(Number.isFinite);
    }
    if (args.customerId != null && Number.isFinite(args.customerId)) {
        return [args.customerId];
    }
    return undefined;
}

/**
 * Delete CustomerPolicyTrend rows for an account (optionally one/more customers).
 * Used after Invoice/Payment clear-before-import so charts cannot keep pre-clear AR/risk.
 */
export async function deleteCustomerPolicyTrendForScope(
    args: CreditSnapshotScopeArgs
): Promise<number> {
    const db = args.dbClient ?? defaultPrisma;
    const customerIds = resolveCustomerIds(args);
    return db.$executeRaw`
        DELETE FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${args.accountId}
          AND (
            ${customerIds == null}::boolean
            OR t.customer_id = ANY(${customerIds ?? []}::int[])
          )
    `;
}

/**
 * Delete account-wide CreditDashboardDailySnapshot rows.
 * CDP has no customer_id — only call for account-wide clears/rewrites.
 */
export async function deleteCreditDashboardDailySnapshotsForAccount(args: {
    accountId: number;
    dbClient?: DbClient;
}): Promise<number> {
    const db = args.dbClient ?? defaultPrisma;
    return db.$executeRaw`
        DELETE FROM "CreditDashboardDailySnapshot"
        WHERE account_id = ${args.accountId}
    `;
}

/**
 * Delete account-wide InsurancePolicyTrend rows (includes total_open_ar rollups).
 * Only call for account-wide clears/rewrites.
 */
export async function deleteInsurancePolicyTrendForAccount(args: {
    accountId: number;
    dbClient?: DbClient;
}): Promise<number> {
    const db = args.dbClient ?? defaultPrisma;
    return db.$executeRaw`
        DELETE FROM "InsurancePolicyTrend"
        WHERE account_id = ${args.accountId}
    `;
}

/**
 * After Invoice and/or Payment clear: wipe CPT for the clear scope; wipe CDP + IPT
 * only when the clear is account-wide (no customer grain on those tables).
 */
export async function purgeCreditSnapshotsAfterInvoiceOrPaymentClear(args: {
    accountId: number;
    customerId?: number | null;
    dbClient?: DbClient;
}): Promise<void> {
    await deleteCustomerPolicyTrendForScope({
        accountId: args.accountId,
        customerId: args.customerId,
        dbClient: args.dbClient,
    });
    if (args.customerId == null) {
        await deleteCreditDashboardDailySnapshotsForAccount({
            accountId: args.accountId,
            dbClient: args.dbClient,
        });
        await deleteInsurancePolicyTrendForAccount({
            accountId: args.accountId,
            dbClient: args.dbClient,
        });
    }
}

/**
 * Delete CPT rows linked to inactive CustomerPolicy that are no longer valid
 * history for the scope. Complements per-day pruneInactiveCustomerPolicyTrendRows.
 *
 * Keeps superseded-history CPT (inactive + null end + a later successor, or
 * inactive with end_date and snapshot_date &lt; end). Deletes:
 * - dated unassign / run-off: snapshot_date ≥ policy_change_end_date
 * - orphan inactive (null end, no later successor): all CPT for that version
 */
export async function deleteInactiveCustomerPolicyTrendRowsForScope(
    args: CreditSnapshotScopeArgs
): Promise<number> {
    const db = args.dbClient ?? defaultPrisma;
    const customerIds = resolveCustomerIds(args);
    return db.$executeRaw`
        DELETE FROM "CustomerPolicyTrend" t
        USING "CustomerPolicy" cp
        WHERE t.customer_policy_id = cp.id
          AND cp.is_active = false
          AND t.account_id = ${args.accountId}
          AND (
            ${customerIds == null}::boolean
            OR t.customer_id = ANY(${customerIds ?? []}::int[])
          )
          AND (
            (
              cp.policy_change_end_date IS NOT NULL
              AND t.snapshot_date >= cp.policy_change_end_date
            )
            OR (
              cp.policy_change_end_date IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM "CustomerPolicy" later
                WHERE later.customer_id = cp.customer_id
                  AND (
                    later.policy_change_start_date > cp.policy_change_start_date
                    OR (
                      later.policy_change_start_date = cp.policy_change_start_date
                      AND later.id > cp.id
                    )
                  )
              )
            )
          )
    `;
}

/**
 * Delete snapshot history strictly before `beforeDate` so charts cannot keep
 * pre-window orphans after clear + rewrite with a later from_date.
 * CPT always; CDP + IPT only when customer scope is account-wide.
 */
export async function deleteCreditSnapshotHistoryBeforeDate(args: {
    accountId: number;
    beforeDate: Date;
    customerIds?: number[];
    dbClient?: DbClient;
}): Promise<void> {
    const db = args.dbClient ?? defaultPrisma;
    const customerIds =
        args.customerIds != null && args.customerIds.length > 0
            ? args.customerIds.filter(Number.isFinite)
            : undefined;

    await db.$executeRaw`
        DELETE FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${args.accountId}
          AND t.snapshot_date < ${args.beforeDate}::date
          AND (
            ${customerIds == null}::boolean
            OR t.customer_id = ANY(${customerIds ?? []}::int[])
          )
    `;

    if (customerIds == null) {
        await db.$executeRaw`
            DELETE FROM "CreditDashboardDailySnapshot"
            WHERE account_id = ${args.accountId}
              AND snapshot_date < ${args.beforeDate}::date
        `;
        await db.$executeRaw`
            DELETE FROM "InsurancePolicyTrend"
            WHERE account_id = ${args.accountId}
              AND snapshot_date < ${args.beforeDate}::date
        `;
    }
}

/**
 * Fresh rewrite/backfill window start: drop inactive-CP CPT duplicates, then
 * drop any snapshot days before from_date for the scope.
 */
export async function prepareCreditSnapshotHistoryForRewriteWindow(args: {
    accountId: number;
    fromDate: Date;
    customerIds?: number[];
    dbClient?: DbClient;
}): Promise<void> {
    await deleteInactiveCustomerPolicyTrendRowsForScope({
        accountId: args.accountId,
        customerIds: args.customerIds,
        dbClient: args.dbClient,
    });
    await deleteCreditSnapshotHistoryBeforeDate({
        accountId: args.accountId,
        beforeDate: args.fromDate,
        customerIds: args.customerIds,
        dbClient: args.dbClient,
    });
}
