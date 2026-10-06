/**
 * After parent_customer_id connect/disconnect/reparent: rewrite CustomerPolicyTrend
 * history for affected pool roots (and members), overlay pool capacity gap /
 * at-risk on shells (leaf children zeroed; nested shells kept), then rewrite
 * CreditDashboardDailySnapshot (and Portfolio Health inputs that read those rows)
 * for the same date range.
 *
 * Membership for past days = today's pool (link treated as always-on).
 * Failures throw so the caller can roll back / fail the parent save.
 *
 * Dashboard UI scope (PRD D11): each shell's overlay uses its **local subtree**
 * (self + descendants), not only the top-root pool — so mid-level shells match
 * local∩BU live cards after BU is applied at the API.
 */
import { Prisma } from "@prisma/client";

import { prisma, type DbClient } from "../domain-db";
import { rewriteCustomerAsOfRange } from "./asOfRewriteQueue";
import { enumerateUtcDaysInclusive } from "./creditAsOfBackfillJob";
import {
    elapsedMsSince,
    inclusiveUtcDaySpan,
} from "./creditPoolParentChangeTiming";
import { customerIdsWithChildren } from "./creditPoolShellGuards";
import { computeTopUpUsageMetrics } from "./invoiceCapacityGapAmounts";
import {
    createCreditPoolMembershipCache,
    listDescendantCustomerIds,
    resolveCreditPoolMemberIds,
    type CreditPoolMembershipCache,
} from "./parentCustomerCreditInheritance";
import {
    isActiveTopUp,
    resolveEffectiveApprovedLimitFromTopUpRows,
    type TopUpRowForResolution,
} from "./resolveEffectiveApprovedLimit";
import {
    startOfTodayUtc,
    toUtcDateOnly,
} from "./shared/insurancePolicyLifecycle";

async function earliestCustomerArActivityDate(
    accountId: number,
    customerIds: readonly number[],
    dbClient: DbClient
): Promise<Date | null> {
    if (customerIds.length === 0) {
        return null;
    }
    const ids = [...customerIds];
    const [invoiceAgg, paymentAgg] = await Promise.all([
        dbClient.invoice.aggregate({
            where: {
                account_id: accountId,
                customer_id: { in: ids },
            },
            _min: { invoice_date: true },
        }),
        dbClient.invoicePayment.aggregate({
            where: {
                account_id: accountId,
                customer_id: { in: ids },
            },
            _min: { payment_date: true },
        }),
    ]);
    const candidates: Date[] = [];
    if (invoiceAgg._min.invoice_date) {
        candidates.push(toUtcDateOnly(invoiceAgg._min.invoice_date));
    }
    if (paymentAgg._min.payment_date) {
        candidates.push(toUtcDateOnly(paymentAgg._min.payment_date));
    }
    if (candidates.length === 0) {
        return null;
    }
    candidates.sort((a, b) => a.getTime() - b.getTime());
    return candidates[0] ?? null;
}

/**
 * Sum **leaf** member open AR vs shell effective limit for pool capacity gap;
 * approximate pool at-risk as min(pool AR, gap + Σ terms breach). Persist pool
 * AR / at-risk / compliant (AR − at-risk) / health index / terms-breach onto
 * the shell CTP. Stamp extra cover, effective limit, and usage percents from
 * **this shell’s** CustomerTopUp rows (not descendants).
 * Zero gap/at-risk only on **leaf** children (nested shells keep their own
 * local overlay).
 *
 * Scope = local subtree of each `rootCustomerIds` entry (self + descendants).
 * Nested shells are excluded from the AR/terms sum so mid-level rolled CTP is
 * not double-counted into the top root.
 */
export async function overlayPoolCapacityGapAndAtRiskOnTrends(args: {
    accountId: number;
    rootCustomerIds: readonly number[];
    fromDate: Date;
    toDate: Date;
    dbClient: DbClient;
    cache?: CreditPoolMembershipCache;
}): Promise<void> {
    const { accountId, rootCustomerIds, fromDate, toDate, dbClient } = args;
    const cache = args.cache ?? createCreditPoolMembershipCache();
    const uniqueShells = [...new Set(rootCustomerIds)].filter(Number.isFinite);
    if (uniqueShells.length === 0) {
        return;
    }

    // Deepest shells first so nested local overlays exist before a parent sums
    // leaves (parents never sum nested-shell CTP rows).
    const depthByShell = new Map<number, number>();
    for (const shellId of uniqueShells) {
        const descendants = await listDescendantCustomerIds(
            shellId,
            accountId,
            dbClient,
            cache
        );
        depthByShell.set(shellId, descendants.length);
    }
    uniqueShells.sort(
        (a, b) => (depthByShell.get(a) ?? 0) - (depthByShell.get(b) ?? 0)
    );

    for (const shellId of uniqueShells) {
        const descendants = await listDescendantCustomerIds(
            shellId,
            accountId,
            dbClient,
            cache
        );
        if (descendants.length === 0) {
            continue;
        }
        const memberIds = [shellId, ...descendants];
        const nestedShellIds = await customerIdsWithChildren(
            memberIds,
            dbClient
        );
        // Invoice-bearing customers only — exclude every shell (including self).
        const leafIds = memberIds.filter((id) => !nestedShellIds.has(id));
        if (leafIds.length === 0) {
            continue;
        }

        const [dayRows, shellTopUps] = await Promise.all([
            dbClient.$queryRaw<
                Array<{
                    snapshot_date: Date;
                    pool_receivables: number | null;
                    pool_terms_breach: number | null;
                    pool_terms_breach_count: number | null;
                    root_approved_limit: number | null;
                    root_approved_limit_currency: string | null;
                    root_insurance_policy_id: number | null;
                    root_outdated_dcl: boolean | null;
                    root_excluded_from_policy: boolean | null;
                }>
            >`
            SELECT
                t.snapshot_date,
                COALESCE(SUM(
                    CASE
                        WHEN t.customer_id IN (${Prisma.join(leafIds)})
                        THEN COALESCE(t.total_receivables, 0)
                        ELSE 0
                    END
                ), 0)::float8 AS pool_receivables,
                COALESCE(SUM(
                    CASE
                        WHEN t.customer_id IN (${Prisma.join(leafIds)})
                        THEN COALESCE(t.terms_breach_amount, 0)
                        ELSE 0
                    END
                ), 0)::float8 AS pool_terms_breach,
                COALESCE(SUM(
                    CASE
                        WHEN t.customer_id IN (${Prisma.join(leafIds)})
                        THEN COALESCE(t.terms_breach_count, 0)
                        ELSE 0
                    END
                ), 0)::float8 AS pool_terms_breach_count,
                MAX(
                    CASE
                        WHEN t.customer_id = ${shellId}
                        THEN t.approved_limit
                        ELSE NULL
                    END
                )::float8 AS root_approved_limit,
                MAX(
                    CASE
                        WHEN t.customer_id = ${shellId}
                        THEN t.approved_limit_currency
                        ELSE NULL
                    END
                ) AS root_approved_limit_currency,
                MAX(
                    CASE
                        WHEN t.customer_id = ${shellId}
                        THEN t.insurance_policy_id
                        ELSE NULL
                    END
                )::int AS root_insurance_policy_id,
                BOOL_OR(
                    t.customer_id = ${shellId} AND COALESCE(t.outdated_dcl, false)
                ) AS root_outdated_dcl,
                BOOL_OR(
                    t.customer_id = ${shellId}
                    AND COALESCE(t.excluded_from_policy, false)
                ) AS root_excluded_from_policy
            FROM "CustomerPolicyTrend" t
            WHERE t.account_id = ${accountId}
              AND t.customer_id IN (${Prisma.join(memberIds)})
              AND t.snapshot_date >= ${fromDate}::date
              AND t.snapshot_date <= ${toDate}::date
            GROUP BY t.snapshot_date
        `,
            dbClient.customerTopUp.findMany({
                where: {
                    customer_id: shellId,
                    cancelled_at: null,
                    start_date: { lte: toDate },
                    end_date: { gte: fromDate },
                    InsurancePolicy: { policy_kind: "TopUp" },
                },
                select: {
                    id: true,
                    top_up_type: true,
                    top_up_value: true,
                    currency: true,
                    start_date: true,
                    end_date: true,
                    cancelled_at: true,
                    InsurancePolicy: {
                        select: {
                            id: true,
                            allow_concurrent_top_ups: true,
                            parent_insurance_policy_id: true,
                        },
                    },
                },
            }) as Promise<TopUpRowForResolution[]>,
        ]);

        const valueRows: Prisma.Sql[] = [];
        for (const day of dayRows) {
            const dayStart = toUtcDateOnly(day.snapshot_date);
            const poolAr = Math.max(0, Number(day.pool_receivables ?? 0));
            const approvedLimitRaw = day.root_approved_limit;
            const approvedLimit =
                approvedLimitRaw != null && Number.isFinite(Number(approvedLimitRaw))
                    ? Math.max(0, Number(approvedLimitRaw))
                    : 0;
            const parentPolicyId = day.root_insurance_policy_id ?? undefined;
            const activeForDay = shellTopUps.filter(
                (row) =>
                    isActiveTopUp(row, dayStart) &&
                    (parentPolicyId == null ||
                        row.InsurancePolicy.parent_insurance_policy_id ===
                            parentPolicyId)
            );
            const resolved = await resolveEffectiveApprovedLimitFromTopUpRows(
                activeForDay,
                {
                    asOfDate: dayStart,
                    baseApprovedLimit:
                        approvedLimitRaw != null
                            ? new Prisma.Decimal(approvedLimit)
                            : null,
                    baseApprovedLimitCurrency:
                        day.root_approved_limit_currency?.trim().toUpperCase() ??
                        null,
                    parentPrimaryPolicyId: parentPolicyId,
                    outdatedDcl: day.root_outdated_dcl === true,
                    excludedFromPolicy: day.root_excluded_from_policy === true,
                    dbClient,
                }
            );
            const topUpTotal = Math.max(0, resolved.topUpTotalInLimitCurrency);
            const effectiveLimit = Math.max(
                0,
                resolved.effectiveApprovedLimit ?? approvedLimit
            );
            const poolGap = Math.max(0, poolAr - effectiveLimit);
            const poolTerms = Math.max(0, Number(day.pool_terms_breach ?? 0));
            const poolTermsCount = Math.max(
                0,
                Math.round(Number(day.pool_terms_breach_count ?? 0))
            );
            const poolAtRisk = Math.min(poolAr, poolGap + poolTerms);
            const poolCompliant = Math.max(0, poolAr - poolAtRisk);
            const poolHealthIndex =
                poolAr > 0
                    ? Math.max(
                          0,
                          Math.min(100, (100 * poolCompliant) / poolAr)
                      )
                    : 100;
            const metrics = computeTopUpUsageMetrics({
                ar: poolAr,
                approvedLimit,
                topUpTotal,
            });
            const policyUsagePct = Math.min(999.99, metrics.policyUsage * 100);
            const topUpUsagePct = Math.min(999.99, metrics.topUpUsage * 100);
            const effectiveUsagePct = Math.min(
                999.99,
                metrics.effectiveUsage * 100
            );

            valueRows.push(
                Prisma.sql`(${dayStart}::date, ${poolGap}::float8, ${poolAtRisk}::float8, ${poolCompliant}::float8, ${poolHealthIndex}::float8, ${poolAr}::float8, ${poolTerms}::float8, ${poolTermsCount}::int, ${topUpTotal}::float8, ${effectiveLimit}::float8, ${activeForDay.length}::int, ${policyUsagePct}::float8, ${topUpUsagePct}::float8, ${effectiveUsagePct}::float8)`
            );
        }

        if (valueRows.length > 0) {
            // One UPDATE…FROM (VALUES …) instead of per-day updateMany.
            await dbClient.$executeRaw`
                UPDATE "CustomerPolicyTrend" AS t
                SET
                    capacity_gap_amount = v.pool_gap,
                    at_risk_exposure = v.pool_at_risk,
                    compliant_exposure = v.pool_compliant,
                    health_index = v.pool_health_index,
                    total_receivables = v.pool_ar,
                    usage_amount = v.pool_ar,
                    terms_breach_amount = v.pool_terms,
                    terms_breach_count = v.pool_terms_count,
                    top_up_total = v.top_up_total,
                    effective_approved_limit = v.effective_limit,
                    active_top_up_count = v.active_top_up_count,
                    policy_usage_pct = v.policy_usage_pct,
                    top_up_usage_pct = v.top_up_usage_pct,
                    effective_usage_pct = v.effective_usage_pct,
                    usage_pct = v.effective_usage_pct
                FROM (VALUES ${Prisma.join(valueRows)}) AS v(
                    snapshot_date,
                    pool_gap,
                    pool_at_risk,
                    pool_compliant,
                    pool_health_index,
                    pool_ar,
                    pool_terms,
                    pool_terms_count,
                    top_up_total,
                    effective_limit,
                    active_top_up_count,
                    policy_usage_pct,
                    top_up_usage_pct,
                    effective_usage_pct
                )
                WHERE t.account_id = ${accountId}
                  AND t.customer_id = ${shellId}
                  AND t.snapshot_date = v.snapshot_date
            `;
        }

        // Zero gap/at-risk on leaf children only — nested shells keep local overlay.
        await dbClient.customerPolicyTrend.updateMany({
            where: {
                account_id: accountId,
                customer_id: { in: leafIds },
                snapshot_date: {
                    gte: fromDate,
                    lte: toDate,
                },
            },
            data: {
                capacity_gap_amount: 0,
                at_risk_exposure: 0,
            },
        });
    }
}

async function rewriteCreditDashboardSnapshotsForRange(args: {
    accountId: number;
    fromDate: Date;
    toDate: Date;
    dbClient: DbClient;
    takeCreditDashboardDailySnapshotsForAccount?: (
        accountId: number,
        options: {
            snapshotDate: Date;
            asOfLines?: import("./asOfOpenAr").AsOfOpenInvoiceLine[];
            ignoreReportingBreach?: boolean;
            runContext?: import("./creditAsOfBackfillRunContext").CreditAsOfBackfillRunContext;
        }
    ) => Promise<unknown>;
}): Promise<number> {
    const takeDashboard =
        args.takeCreditDashboardDailySnapshotsForAccount ??
        (
            await import("./creditDashboardSnapshotService")
        ).takeCreditDashboardDailySnapshotsForAccount;

    const {
        buildCreditAsOfBackfillRunContext,
        ensureCapacityGapsForBackfillRun,
    } = await import("./creditAsOfBackfillRunContext");
    let runContext = await buildCreditAsOfBackfillRunContext(args.accountId, {
        dbClient: args.dbClient,
        replayFromDate: args.fromDate,
        replayToDate: args.toDate,
    });
    runContext = await ensureCapacityGapsForBackfillRun(runContext, {
        dbClient: args.dbClient,
    });

    const {
        loadAsOfOpenInvoiceLedgerRange,
        deriveAsOfOpenInvoiceCandidatesFromLedger,
    } = await import("./asOfOpenArLedgerPreload");
    const ledger = await loadAsOfOpenInvoiceLedgerRange(
        args.accountId,
        args.toDate,
        { dbClient: args.dbClient }
    );

    const days = enumerateUtcDaysInclusive(args.fromDate, args.toDate);
    let daysRewritten = 0;
    for (const day of days) {
        const asOfLines = deriveAsOfOpenInvoiceCandidatesFromLedger(
            ledger,
            day
        );
        await takeDashboard(args.accountId, {
            snapshotDate: day,
            asOfLines,
            runContext,
        });
        daysRewritten += 1;
    }
    return daysRewritten;
}

/**
 * Synchronous CPT + CDP history refresh for pool roots remirrored by a
 * parent-link change. Throws on failure (caller must fail / roll back the
 * parent save).
 */
export async function syncCreditPoolPolicyTrendsAfterParentChange(args: {
    accountId: number;
    remirroredRoots: readonly number[];
    dbClient?: DbClient;
    cache?: CreditPoolMembershipCache;
    rewriteCustomerAsOfRange?: typeof rewriteCustomerAsOfRange;
    rewriteCreditDashboardForRange?: (args: {
        accountId: number;
        fromDate: Date;
        toDate: Date;
        dbClient: DbClient;
    }) => Promise<number>;
    takeCreditDashboardDailySnapshotsForAccount?: (
        accountId: number,
        options: {
            snapshotDate: Date;
            asOfLines?: import("./asOfOpenAr").AsOfOpenInvoiceLine[];
            ignoreReportingBreach?: boolean;
            runContext?: import("./creditAsOfBackfillRunContext").CreditAsOfBackfillRunContext;
        }
    ) => Promise<unknown>;
    /** Test seam: skip CPT pool gap overlay when true. */
    skipPoolTrendOverlay?: boolean;
    /**
     * Default: rewrite **today** CTP+CDP synchronously, then start a **scoped**
     * async CTP history job (pool members from earliest invoice/payment → today).
     * CDP chart history is left to overnight / Portfolio Health Generate.
     * Pass `full_sync` only for tests that assert in-process history rewrite
     * (CTP+CDP for the full window).
     */
    historyMode?: "today_plus_async" | "full_sync";
    /** Skip starting the async scoped history job (tests). */
    skipAsyncHistoryJob?: boolean;
    requestedBy?: string | null;
}): Promise<{
    customerIds: number[];
    fromDate: Date | null;
    toDate: Date;
    daysRewritten: number;
    creditDashboardDaysRewritten: number;
    historyMode: "today_plus_async" | "full_sync";
    asyncHistoryJob: import("./creditAsOfBackfillJob").CreditAsOfBackfillJobView | null;
}> {
    const dbClient = args.dbClient ?? prisma;
    const cache = args.cache ?? createCreditPoolMembershipCache();
    const historyMode = args.historyMode ?? "today_plus_async";
    const uniqueRoots = [...new Set(args.remirroredRoots)].filter(Number.isFinite);
    if (uniqueRoots.length === 0) {
        return {
            customerIds: [],
            fromDate: null,
            toDate: startOfTodayUtc(),
            daysRewritten: 0,
            creditDashboardDaysRewritten: 0,
            historyMode,
            asyncHistoryJob: null,
        };
    }

    const customerIdSet = new Set<number>();
    for (const rootId of uniqueRoots) {
        const { memberIds } = await resolveCreditPoolMemberIds(
            rootId,
            args.accountId,
            dbClient,
            cache
        );
        for (const id of memberIds) {
            customerIdSet.add(id);
        }
    }
    const customerIds = [...customerIdSet];
    const toDate = startOfTodayUtc();
    const earliestAr = await earliestCustomerArActivityDate(
        args.accountId,
        customerIds,
        dbClient
    );
    // No point rewriting empty pre-AR snapshot days — floor to first invoice/payment
    // among pool members (shells have none). If none, today-only is enough.
    const historyFromDate = earliestAr ?? toDate;
    const syncFromDate =
        historyMode === "full_sync" ? historyFromDate : toDate;
    const daySpan = inclusiveUtcDaySpan(historyFromDate, toDate);
    const syncDaySpan = inclusiveUtcDaySpan(syncFromDate, toDate);
    const startedMs = Date.now();

    const { setCreditPoolParentChangeSyncStep } = await import(
        "./creditPoolParentChangeProgress"
    );
    await setCreditPoolParentChangeSyncStep({
        accountId: args.accountId,
        step: "ctp_today",
        dbClient,
    });

    const rewriteFn = args.rewriteCustomerAsOfRange ?? rewriteCustomerAsOfRange;
    let rewrite: { daysRewritten: number };
    try {
        rewrite = await rewriteFn(
            {
                accountId: args.accountId,
                customerIds,
                fromDate: syncFromDate,
                toDate,
            },
            { dbClient: dbClient as never }
        );
    } catch (error) {
        console.error("[ParentCustomerCredit] CTP rewrite failed", {
            accountId: args.accountId,
            memberCount: customerIds.length,
            syncDaySpan,
            syncFromDate: syncFromDate.toISOString(),
            toDate: toDate.toISOString(),
            errorName: error instanceof Error ? error.name : null,
            errorMessage:
                error instanceof Error ? error.message : String(error),
            elapsedMs: elapsedMsSince(startedMs),
        });
        throw error;
    }

    if (!args.skipPoolTrendOverlay) {
        const shellIds = await customerIdsWithChildren(customerIds, dbClient);
        if (shellIds.size > 0) {
            await setCreditPoolParentChangeSyncStep({
                accountId: args.accountId,
                step: "ctp_overlay",
                dbClient,
            });
            const overlayStartedMs = Date.now();
            try {
                await overlayPoolCapacityGapAndAtRiskOnTrends({
                    accountId: args.accountId,
                    rootCustomerIds: [...shellIds],
                    fromDate: syncFromDate,
                    toDate,
                    dbClient,
                    cache,
                });
            } catch (error) {
                console.error("[ParentCustomerCredit] CTP overlay failed", {
                    accountId: args.accountId,
                    shellCount: shellIds.size,
                    syncDaySpan,
                    errorName: error instanceof Error ? error.name : null,
                    errorMessage:
                        error instanceof Error ? error.message : String(error),
                    elapsedMs: elapsedMsSince(overlayStartedMs),
                });
                throw error;
            }
        }
    }

    const rewriteCdp =
        args.rewriteCreditDashboardForRange ??
        ((rangeArgs) =>
            rewriteCreditDashboardSnapshotsForRange({
                ...rangeArgs,
                takeCreditDashboardDailySnapshotsForAccount:
                    args.takeCreditDashboardDailySnapshotsForAccount,
            }));

    let creditDashboardDaysRewritten = 0;
    await setCreditPoolParentChangeSyncStep({
        accountId: args.accountId,
        step: "cdp_today",
        dbClient,
    });
    const cdpStartedMs = Date.now();
    try {
        creditDashboardDaysRewritten = await rewriteCdp({
            accountId: args.accountId,
            fromDate: syncFromDate,
            toDate,
            dbClient,
        });
    } catch (error) {
        console.error("[ParentCustomerCredit] CDP rewrite failed", {
            accountId: args.accountId,
            syncDaySpan,
            syncFromDate: syncFromDate.toISOString(),
            toDate: toDate.toISOString(),
            errorName: error instanceof Error ? error.name : null,
            errorMessage:
                error instanceof Error ? error.message : String(error),
            elapsedMs: elapsedMsSince(cdpStartedMs),
        });
        throw error;
    }

    let asyncHistoryJob: import("./creditAsOfBackfillJob").CreditAsOfBackfillJobView | null =
        null;
    // When skipAsyncHistoryJob, the caller starts history (and completes the
    // syncing job) after breach / open-AR rollups.
    if (
        historyMode === "today_plus_async" &&
        !args.skipAsyncHistoryJob &&
        daySpan > syncDaySpan
    ) {
        await setCreditPoolParentChangeSyncStep({
            accountId: args.accountId,
            step: "history",
            dbClient,
        });
        const jobStartedMs = Date.now();
        try {
            const { startCreditPoolParentHistoryJob } = await import(
                "./creditPoolParentHistoryJob"
            );
            asyncHistoryJob = await startCreditPoolParentHistoryJob({
                accountId: args.accountId,
                customerIds,
                fromDate: historyFromDate,
                toDate,
                requestedBy: args.requestedBy ?? null,
                dbClient,
                skipPoolTrendOverlay: args.skipPoolTrendOverlay === true,
            });
        } catch (error) {
            // Parent save already applied live today sync; history can be
            // retried on the next parent-link change.
            console.error("[ParentCustomerCredit] scoped history job failed", {
                accountId: args.accountId,
                memberCount: customerIds.length,
                daySpan,
                errorName: error instanceof Error ? error.name : null,
                errorMessage:
                    error instanceof Error ? error.message : String(error),
                elapsedMs: elapsedMsSince(jobStartedMs),
            });
            const { completeCreditPoolParentChangeSyncProgress } = await import(
                "./creditPoolParentChangeProgress"
            );
            await completeCreditPoolParentChangeSyncProgress({
                accountId: args.accountId,
                dbClient,
            });
        }
    } else if (
        historyMode === "today_plus_async" &&
        !args.skipAsyncHistoryJob
    ) {
        const { completeCreditPoolParentChangeSyncProgress } = await import(
            "./creditPoolParentChangeProgress"
        );
        await completeCreditPoolParentChangeSyncProgress({
            accountId: args.accountId,
            dbClient,
        });
    }

    return {
        customerIds,
        fromDate: historyFromDate,
        toDate,
        daysRewritten: rewrite.daysRewritten,
        creditDashboardDaysRewritten,
        historyMode,
        asyncHistoryJob,
    };
}
