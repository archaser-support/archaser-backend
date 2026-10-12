import { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../domain-db";

import {
    findAccountSnapshotLeaseBlocker,
    warnSnapshotWriterSkippedForLease,
} from "./accountBackgroundJobLease";
import { customerPolicyTrendEffectiveRowOrderSql } from "./customerPolicyAsOfVersion";
import { runInsurancePolicyStatusMaintenance } from "./insurancePolicyStatusCron";
import {
    primaryEffectivelyActivePrismaWhere,
    startOfTodayUtc,
    toUtcDateOnly,
} from "./shared/insurancePolicyLifecycle";

type RawCapableClient = {
    $queryRaw: PrismaClient["$queryRaw"];
    $executeRaw: PrismaClient["$executeRaw"];
};

const ROLLUP_UPDATE_BATCH_SIZE = 500;

const HEADER_SCALAR_FIELDS = [
    "policy_number",
    "start_date",
    "end_date",
    "currency",
    "insurer_name",
    "policy_kind",
    "parent_insurance_policy_id",
    "allow_concurrent_top_ups",
    "max_total_cover",
    "max_total_dcl_sdl_cover",
    "min_credit_score",
    "score_validity_period_months",
    "max_dcl",
    "dcl_customer_since_months",
    "max_payment_term",
    "max_allowed_mep",
    "reporting_days",
    "cost_calculation_method",
    "cost_percent",
    "registration_fee_percent",
    "status",
    "active_customer_count",
    "total_approved_limit",
    "total_open_ar",
    "policy_usage_pct",
    "named_policy_row_count",
    "country_row_count",
] as const;

export type InsurancePolicyTrendPoint = {
    snapshotDate: string;
    policyNumber: string;
    status: string;
    maxTotalCover: number | null;
    costCalculationMethod: string | null;
    costPercent: number | null;
    registrationFeePercent: number | null;
    activeCustomerCount: number;
    totalApprovedLimit: number | null;
    totalOpenAr: number;
    policyUsagePct: number | null;
    namedPolicyRowCount: number;
    countryRowCount: number;
};

export type InsurancePolicyTrendResponse = {
    policyId: number;
    fromDate: string | null;
    toDate: string | null;
    latest: InsurancePolicyTrendPoint | null;
    series: InsurancePolicyTrendPoint[];
};

export type InsurancePolicyCountryTrendPoint = {
    snapshotDate: string;
    countryId: number;
    insurancePolicyCountryId: string;
    paymentTermCap: number | null;
    countryMep: number | null;
    reportingDays: number | null;
    countryMaxLimit: number | null;
};

export type InsurancePolicyCountryTrendResponse = {
    policyId: number;
    countryId: number | null;
    fromDate: string | null;
    toDate: string | null;
    series: InsurancePolicyCountryTrendPoint[];
};

export type NamedPolicyTrendPoint = {
    snapshotDate: string;
    namedPolicyId: number;
    customerNumber: string;
    maxPaymentTerm: number | null;
    customerMep: number | null;
    reportingDays: number | null;
    customerMaxLimit: number | null;
    limitExpirationDate: string | null;
};

export type NamedPolicyTrendResponse = {
    policyId: number;
    namedPolicyId: number | null;
    customerNumber: string | null;
    fromDate: string | null;
    toDate: string | null;
    series: NamedPolicyTrendPoint[];
};

export type InsurancePolicyConfigChangeField = {
    field: string;
    previous: string | number | boolean | null;
    current: string | number | boolean | null;
};

export type InsurancePolicyConfigChangesResponse = {
    policyId: number;
    fromSnapshotDate: string | null;
    toSnapshotDate: string | null;
    headerChanges: InsurancePolicyConfigChangeField[];
    addedCountryIds: number[];
    removedCountryIds: number[];
    addedNamedPolicyIds: number[];
    removedNamedPolicyIds: number[];
};

function addUtcCalendarDays(base: Date, days: number): Date {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function normalizeDateString(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
    if (value == null) {
        return null;
    }
    return new Prisma.Decimal(value).toNumber();
}

/** Exported for unit tests — policy-level usage vs max_total_cover. */
export function computePolicyUsagePct(
    totalOpenAr: number,
    maxTotalCover: number | null
): number | null {
    if (maxTotalCover == null || maxTotalCover <= 0) {
        return null;
    }
    return Math.min(999.99, (100 * totalOpenAr) / maxTotalCover);
}

function clampDays(days: number | undefined, defaultDays: number, min: number, max: number): number {
    return Math.max(min, Math.min(days ?? defaultDays, max));
}

type PolicyDayRollup = {
    activeCustomerCount: number;
    totalApprovedLimit: Prisma.Decimal | null;
    totalOpenAr: number;
};

const EMPTY_POLICY_DAY_ROLLUP: PolicyDayRollup = {
    activeCustomerCount: 0,
    totalApprovedLimit: null,
    totalOpenAr: 0,
};

function policyDayKey(policyId: number, snapshotDate: Date): string {
    return `${policyId}:${normalizeDateString(snapshotDate)}`;
}

/**
 * Policy totals per (policy, day) summed from that day's
 * {@link CustomerPolicyTrend} rows, run-off rows included. One row per
 * customer + policy + day (effective version wins over run-off); customers
 * outside Active / Inactive collection status are skipped. Credit-pool
 * members carry the root's mirrored limit and the root row carries pool AR, so
 * limit and open AR come from top-level customers only; the customer count
 * includes every member.
 */
async function loadPolicyDayRollupsFromCustomerPolicyTrend(args: {
    accountId: number;
    policyIds: readonly number[];
    fromDate: Date;
    toDate: Date;
    dbClient: RawCapableClient;
}): Promise<Map<string, PolicyDayRollup>> {
    const rollups = new Map<string, PolicyDayRollup>();
    if (args.policyIds.length === 0) {
        return rollups;
    }
    const rows = await args.dbClient.$queryRaw<
        Array<{
            insurance_policy_id: number;
            snapshot_date: Date;
            customer_count: number;
            total_approved_limit: Prisma.Decimal | null;
            total_open_ar: number | null;
        }>
    >`
        SELECT
            t.insurance_policy_id,
            t.snapshot_date,
            COUNT(DISTINCT t.customer_id)::int AS customer_count,
            SUM(
                CASE
                    WHEN c.parent_customer_id IS NULL AND t.limit_value > 0
                    THEN t.limit_value
                    ELSE NULL
                END
            ) AS total_approved_limit,
            COALESCE(SUM(
                CASE
                    WHEN c.parent_customer_id IS NULL
                    THEN GREATEST(COALESCE(t.total_receivables, t.usage_amount, 0), 0)
                    ELSE 0
                END
            ), 0)::float8 AS total_open_ar
        FROM (
            SELECT DISTINCT ON (t.customer_id, t.insurance_policy_id, t.snapshot_date)
                t.customer_id,
                t.insurance_policy_id,
                t.snapshot_date,
                t.total_receivables::float8 AS total_receivables,
                t.usage_amount,
                CASE
                    WHEN t.effective_approved_limit > 0
                    THEN t.effective_approved_limit
                    ELSE t.approved_limit
                END AS limit_value
            FROM "CustomerPolicyTrend" t
            LEFT JOIN "CustomerPolicy" cp ON cp.id = t.customer_policy_id
            WHERE t.account_id = ${args.accountId}
              AND t.insurance_policy_id IN (${Prisma.join([...args.policyIds])})
              AND t.snapshot_date >= ${args.fromDate}::date
              AND t.snapshot_date <= ${args.toDate}::date
            ORDER BY
                t.customer_id,
                t.insurance_policy_id,
                t.snapshot_date,
                ${customerPolicyTrendEffectiveRowOrderSql}
        ) t
        INNER JOIN "Customer" c ON c.id = t.customer_id
        WHERE c.account_id = ${args.accountId}
          AND c.collection_status IN ('Active', 'Inactive')
        GROUP BY t.insurance_policy_id, t.snapshot_date
    `;
    for (const row of rows) {
        rollups.set(policyDayKey(row.insurance_policy_id, row.snapshot_date), {
            activeCustomerCount: Number(row.customer_count ?? 0),
            totalApprovedLimit:
                row.total_approved_limit != null
                    ? new Prisma.Decimal(row.total_approved_limit)
                    : null,
            totalOpenAr: Number(row.total_open_ar ?? 0),
        });
    }
    return rollups;
}

/**
 * Days in range where the account has any {@link CustomerPolicyTrend} row.
 * A day without one has not been written yet (e.g. today before the trend
 * cron), so policy totals for it are not known — not zero.
 */
async function loadAccountDaysWithCustomerPolicyTrend(args: {
    accountId: number;
    fromDate: Date;
    toDate: Date;
    dbClient: RawCapableClient;
}): Promise<Set<string>> {
    const rows = await args.dbClient.$queryRaw<Array<{ snapshot_date: Date }>>`
        SELECT DISTINCT snapshot_date
        FROM "CustomerPolicyTrend"
        WHERE account_id = ${args.accountId}
          AND snapshot_date >= ${args.fromDate}::date
          AND snapshot_date <= ${args.toDate}::date
    `;
    return new Set(rows.map((row) => normalizeDateString(row.snapshot_date)));
}

async function resolveRollupPolicyIdsForCustomers(args: {
    accountId: number;
    customerIds: readonly number[];
    fromDate: Date;
    toDate: Date;
    dbClient: RawCapableClient;
}): Promise<number[]> {
    const rows = await args.dbClient.$queryRaw<Array<{ policy_id: number }>>`
        SELECT cp.insurance_policy_id AS policy_id
        FROM "CustomerPolicy" cp
        INNER JOIN "Customer" c ON c.id = cp.customer_id
        WHERE c.account_id = ${args.accountId}
          AND cp.customer_id IN (${Prisma.join([...args.customerIds])})
          AND cp.insurance_policy_id IS NOT NULL
        UNION
        SELECT t.insurance_policy_id AS policy_id
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${args.accountId}
          AND t.customer_id IN (${Prisma.join([...args.customerIds])})
          AND t.insurance_policy_id IS NOT NULL
          AND t.snapshot_date >= ${args.fromDate}::date
          AND t.snapshot_date <= ${args.toDate}::date
    `;
    return rows.map((row) => Number(row.policy_id)).filter(Number.isFinite);
}

export type InsurancePolicyTrendRollupInput = {
    accountId: number;
    fromDate: Date;
    /** Inclusive; defaults to `fromDate`. */
    toDate?: Date;
    /** Limits the roll-up to policies these customers have (or had) rows on. */
    customerIds?: readonly number[];
    policyId?: number;
};

/**
 * Rewrite policy totals on existing {@link InsurancePolicyTrend} rows for the
 * given days from that day's {@link CustomerPolicyTrend} rows. Header / config
 * fields are left as snapshotted; usage % uses the row's own `max_total_cover`.
 * Days without an Insurance Policy Trend row are not created here; days where
 * the account has no Customer Policy Trend rows keep their totals.
 */
export async function rollUpInsurancePolicyTrendFromCustomerPolicyTrend(
    input: InsurancePolicyTrendRollupInput,
    options?: { dbClient?: RawCapableClient }
): Promise<{ policyRowsUpdated: number }> {
    const db = options?.dbClient ?? prisma;
    const fromDate = toUtcDateOnly(input.fromDate);
    const toDate = toUtcDateOnly(input.toDate ?? input.fromDate);
    if (toDate.getTime() < fromDate.getTime()) {
        return { policyRowsUpdated: 0 };
    }

    let policyScope: number[] | null = null;
    if (input.policyId != null) {
        policyScope = [input.policyId];
    } else {
        const customerIds = (input.customerIds ?? []).filter(Number.isFinite);
        if (customerIds.length > 0) {
            policyScope = await resolveRollupPolicyIdsForCustomers({
                accountId: input.accountId,
                customerIds,
                fromDate,
                toDate,
                dbClient: db,
            });
        }
    }
    if (policyScope != null && policyScope.length === 0) {
        return { policyRowsUpdated: 0 };
    }

    const policyTrendRows = await db.$queryRaw<
        Array<{
            id: bigint;
            insurance_policy_id: number;
            snapshot_date: Date;
            max_total_cover: Prisma.Decimal | null;
        }>
    >`
        SELECT id, insurance_policy_id, snapshot_date, max_total_cover
        FROM "InsurancePolicyTrend"
        WHERE account_id = ${input.accountId}
          AND snapshot_date >= ${fromDate}::date
          AND snapshot_date <= ${toDate}::date
          ${
              policyScope != null
                  ? Prisma.sql`AND insurance_policy_id IN (${Prisma.join(policyScope)})`
                  : Prisma.empty
          }
    `;
    if (policyTrendRows.length === 0) {
        return { policyRowsUpdated: 0 };
    }
    const daysWithCustomerRows = await loadAccountDaysWithCustomerPolicyTrend({
        accountId: input.accountId,
        fromDate,
        toDate,
        dbClient: db,
    });
    const trendRows = policyTrendRows.filter((row) =>
        daysWithCustomerRows.has(normalizeDateString(row.snapshot_date))
    );
    if (trendRows.length === 0) {
        return { policyRowsUpdated: 0 };
    }

    const rollups = await loadPolicyDayRollupsFromCustomerPolicyTrend({
        accountId: input.accountId,
        policyIds: [...new Set(trendRows.map((row) => row.insurance_policy_id))],
        fromDate,
        toDate,
        dbClient: db,
    });

    const valueRows = trendRows.map((row) => {
        const rollup =
            rollups.get(policyDayKey(row.insurance_policy_id, row.snapshot_date)) ??
            EMPTY_POLICY_DAY_ROLLUP;
        const policyUsagePct = computePolicyUsagePct(
            rollup.totalOpenAr,
            decimalToNumber(row.max_total_cover)
        );
        return Prisma.sql`(${row.id}::bigint, ${rollup.activeCustomerCount}::int, ${rollup.totalApprovedLimit}::numeric, ${rollup.totalOpenAr}::float8, ${policyUsagePct}::float8)`;
    });

    let policyRowsUpdated = 0;
    for (let i = 0; i < valueRows.length; i += ROLLUP_UPDATE_BATCH_SIZE) {
        const batch = valueRows.slice(i, i + ROLLUP_UPDATE_BATCH_SIZE);
        policyRowsUpdated += await db.$executeRaw`
            UPDATE "InsurancePolicyTrend" AS ipt
            SET
                active_customer_count = v.active_customer_count,
                total_approved_limit = v.total_approved_limit,
                total_open_ar = v.total_open_ar,
                policy_usage_pct = v.policy_usage_pct,
                modified_at = NOW()
            FROM (VALUES ${Prisma.join(batch)}) AS v(
                id,
                active_customer_count,
                total_approved_limit,
                total_open_ar,
                policy_usage_pct
            )
            WHERE ipt.id = v.id
        `;
    }
    return { policyRowsUpdated };
}

/**
 * Today's policy totals from today's Customer Policy Trend tip, for every
 * credit-insurance account (Customer Policy Trend daily cron). Accounts in
 * `gapFilledAccounts` are rolled up from their first catch-up day.
 */
export async function takeInsurancePolicyTrendRollups(options?: {
    snapshotDate?: Date;
    gapFilledAccounts?: ReadonlyArray<{
        accountId: number;
        fromDate: Date | string;
    }>;
}): Promise<{ accountsProcessed: number; policyRowsUpdated: number }> {
    const snapshotDate = options?.snapshotDate ?? startOfTodayUtc();
    const gapFillFromByAccountId = new Map(
        (options?.gapFilledAccounts ?? []).map((entry) => [
            entry.accountId,
            toUtcDateOnly(entry.fromDate),
        ])
    );
    const accounts = await prisma.account.findMany({
        where: { has_credit_insurance: true },
        select: { id: true },
    });

    let accountsProcessed = 0;
    let policyRowsUpdated = 0;
    for (const account of accounts) {
        const leaseBlocker = await findAccountSnapshotLeaseBlocker(
            account.id,
            prisma
        );
        if (leaseBlocker) {
            warnSnapshotWriterSkippedForLease(
                "InsurancePolicyTrend",
                leaseBlocker
            );
            continue;
        }
        const result = await rollUpInsurancePolicyTrendFromCustomerPolicyTrend({
            accountId: account.id,
            fromDate: gapFillFromByAccountId.get(account.id) ?? snapshotDate,
            toDate: snapshotDate,
        });
        accountsProcessed += 1;
        policyRowsUpdated += result.policyRowsUpdated;
    }
    return { accountsProcessed, policyRowsUpdated };
}

/**
 * Upsert daily insurance policy trend rows for one credit-insurance account.
 * When `policyId` is set, only that Primary policy is snapshotted (if effectively active).
 */
export async function syncInsurancePolicyTrendSnapshotForAccount(
    accountId: number,
    options?: { policyId?: number; snapshotDate?: Date }
): Promise<{
    policyRowsUpserted: number;
    countryRowsUpserted: number;
    namedRowsUpserted: number;
}> {
    const snapshotDate = options?.snapshotDate ?? startOfTodayUtc();

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { has_credit_insurance: true },
    });
    if (!account?.has_credit_insurance) {
        return {
            policyRowsUpserted: 0,
            countryRowsUpserted: 0,
            namedRowsUpserted: 0,
        };
    }

    const policies = await prisma.insurancePolicy.findMany({
        where: {
            account_id: accountId,
            ...primaryEffectivelyActivePrismaWhere(snapshotDate),
            ...(options?.policyId != null ? { id: options.policyId } : {}),
        },
        include: {
            InsurancePolicyCountry: true,
            NamedPolicy: true,
        },
    });

    const rollupDay = toUtcDateOnly(snapshotDate);
    const hasCustomerRowsForDay = (
        await loadAccountDaysWithCustomerPolicyTrend({
            accountId,
            fromDate: rollupDay,
            toDate: rollupDay,
            dbClient: prisma,
        })
    ).has(normalizeDateString(rollupDay));
    const rollupsByPolicyDay = hasCustomerRowsForDay
        ? await loadPolicyDayRollupsFromCustomerPolicyTrend({
              accountId,
              policyIds: policies.map((policy) => policy.id),
              fromDate: rollupDay,
              toDate: rollupDay,
              dbClient: prisma,
          })
        : new Map<string, PolicyDayRollup>();

    let policyRowsUpserted = 0;
    let countryRowsUpserted = 0;
    let namedRowsUpserted = 0;

    for (const policy of policies) {
        const rollup =
            rollupsByPolicyDay.get(policyDayKey(policy.id, rollupDay)) ??
            EMPTY_POLICY_DAY_ROLLUP;
        const totalsValues = hasCustomerRowsForDay
            ? Prisma.sql`${rollup.activeCustomerCount}, ${rollup.totalApprovedLimit}, ${rollup.totalOpenAr}, ${computePolicyUsagePct(
                  rollup.totalOpenAr,
                  decimalToNumber(policy.max_total_cover)
              )}`
            : Prisma.sql`DEFAULT, DEFAULT, DEFAULT, DEFAULT`;
        const totalsUpdate = hasCustomerRowsForDay
            ? Prisma.sql`
                active_customer_count = EXCLUDED.active_customer_count,
                total_approved_limit = EXCLUDED.total_approved_limit,
                total_open_ar = EXCLUDED.total_open_ar,
                policy_usage_pct = EXCLUDED.policy_usage_pct,`
            : Prisma.empty;

        const countryCount = policy.InsurancePolicyCountry.length;
        const namedCount = policy.NamedPolicy.length;

        await prisma.$executeRaw`
            INSERT INTO "InsurancePolicyTrend" (
                account_id,
                insurance_policy_id,
                snapshot_date,
                policy_number,
                start_date,
                end_date,
                currency,
                insurer_name,
                policy_kind,
                parent_insurance_policy_id,
                allow_concurrent_top_ups,
                max_total_cover,
                max_total_dcl_sdl_cover,
                min_credit_score,
                score_validity_period_months,
                max_dcl,
                dcl_customer_since_months,
                max_payment_term,
                max_allowed_mep,
                reporting_days,
                cost_calculation_method,
                cost_percent,
                registration_fee_percent,
                status,
                active_customer_count,
                total_approved_limit,
                total_open_ar,
                policy_usage_pct,
                named_policy_row_count,
                country_row_count,
                modified_at
            ) VALUES (
                ${accountId},
                ${policy.id},
                ${snapshotDate}::date,
                ${policy.policy_number},
                ${policy.start_date},
                ${policy.end_date},
                ${policy.currency},
                ${policy.insurer_name},
                ${policy.policy_kind}::"insurance_policy_kind",
                ${policy.parent_insurance_policy_id},
                ${policy.allow_concurrent_top_ups},
                ${policy.max_total_cover},
                ${policy.max_total_dcl_sdl_cover},
                ${policy.min_credit_score},
                ${policy.score_validity_period_months},
                ${policy.max_dcl},
                ${policy.dcl_customer_since_months},
                ${policy.max_payment_term},
                ${policy.max_allowed_mep},
                ${policy.reporting_days},
                ${policy.cost_calculation_method}::"cost_calculation_method",
                ${policy.cost_percent},
                ${policy.registration_fee_percent},
                ${policy.status}::"record_status",
                ${totalsValues},
                ${namedCount},
                ${countryCount},
                NOW()
            )
            ON CONFLICT (insurance_policy_id, snapshot_date)
            DO UPDATE SET
                account_id = EXCLUDED.account_id,
                policy_number = EXCLUDED.policy_number,
                start_date = EXCLUDED.start_date,
                end_date = EXCLUDED.end_date,
                currency = EXCLUDED.currency,
                insurer_name = EXCLUDED.insurer_name,
                policy_kind = EXCLUDED.policy_kind,
                parent_insurance_policy_id = EXCLUDED.parent_insurance_policy_id,
                allow_concurrent_top_ups = EXCLUDED.allow_concurrent_top_ups,
                max_total_cover = EXCLUDED.max_total_cover,
                max_total_dcl_sdl_cover = EXCLUDED.max_total_dcl_sdl_cover,
                min_credit_score = EXCLUDED.min_credit_score,
                score_validity_period_months = EXCLUDED.score_validity_period_months,
                max_dcl = EXCLUDED.max_dcl,
                dcl_customer_since_months = EXCLUDED.dcl_customer_since_months,
                max_payment_term = EXCLUDED.max_payment_term,
                max_allowed_mep = EXCLUDED.max_allowed_mep,
                reporting_days = EXCLUDED.reporting_days,
                cost_calculation_method = EXCLUDED.cost_calculation_method,
                cost_percent = EXCLUDED.cost_percent,
                registration_fee_percent = EXCLUDED.registration_fee_percent,
                status = EXCLUDED.status,
                ${totalsUpdate}
                named_policy_row_count = EXCLUDED.named_policy_row_count,
                country_row_count = EXCLUDED.country_row_count,
                modified_at = NOW()
        `;
        policyRowsUpserted += 1;

        for (const countryRow of policy.InsurancePolicyCountry) {
            await prisma.$executeRaw`
                INSERT INTO "InsurancePolicyCountryTrend" (
                    account_id,
                    insurance_policy_id,
                    insurance_policy_country_id,
                    country_id,
                    snapshot_date,
                    payment_term_cap,
                    country_mep,
                    reporting_days,
                    country_max_limit,
                    modified_at
                ) VALUES (
                    ${accountId},
                    ${policy.id},
                    ${countryRow.id}::uuid,
                    ${countryRow.country_id},
                    ${snapshotDate}::date,
                    ${countryRow.payment_term_cap},
                    ${countryRow.country_mep},
                    ${countryRow.reporting_days},
                    ${countryRow.country_max_limit},
                    NOW()
                )
                ON CONFLICT (insurance_policy_country_id, snapshot_date)
                DO UPDATE SET
                    account_id = EXCLUDED.account_id,
                    insurance_policy_id = EXCLUDED.insurance_policy_id,
                    country_id = EXCLUDED.country_id,
                    payment_term_cap = EXCLUDED.payment_term_cap,
                    country_mep = EXCLUDED.country_mep,
                    reporting_days = EXCLUDED.reporting_days,
                    country_max_limit = EXCLUDED.country_max_limit,
                    modified_at = NOW()
            `;
            countryRowsUpserted += 1;
        }

        for (const namedRow of policy.NamedPolicy) {
            await prisma.$executeRaw`
                INSERT INTO "NamedPolicyTrend" (
                    account_id,
                    insurance_policy_id,
                    named_policy_id,
                    snapshot_date,
                    customer_number,
                    max_payment_term,
                    customer_mep,
                    reporting_days,
                    customer_max_limit,
                    limit_expiration_date,
                    modified_at
                ) VALUES (
                    ${accountId},
                    ${policy.id},
                    ${namedRow.id},
                    ${snapshotDate}::date,
                    ${namedRow.customer_number},
                    ${namedRow.max_payment_term},
                    ${namedRow.customer_mep},
                    ${namedRow.reporting_days},
                    ${namedRow.customer_max_limit},
                    ${namedRow.limit_expiration_date},
                    NOW()
                )
                ON CONFLICT (named_policy_id, snapshot_date)
                DO UPDATE SET
                    account_id = EXCLUDED.account_id,
                    insurance_policy_id = EXCLUDED.insurance_policy_id,
                    customer_number = EXCLUDED.customer_number,
                    max_payment_term = EXCLUDED.max_payment_term,
                    customer_mep = EXCLUDED.customer_mep,
                    reporting_days = EXCLUDED.reporting_days,
                    customer_max_limit = EXCLUDED.customer_max_limit,
                    limit_expiration_date = EXCLUDED.limit_expiration_date,
                    modified_at = NOW()
            `;
            namedRowsUpserted += 1;
        }
    }

    return {
        policyRowsUpserted,
        countryRowsUpserted,
        namedRowsUpserted,
    };
}

/**
 * Upsert one daily row per effectively active Primary {@link InsurancePolicy} on credit-insurance accounts.
 *
 * **Ops manual backfill** (missed cron day): run
 * `npx tsx scripts/backfill-insurance-policy-trend-snapshots.ts --date=YYYY-MM-DD`
 * Rerunning the same UTC calendar date is idempotent (upsert).
 */
export async function takeInsurancePolicyTrendSnapshots(options?: {
    snapshotDate?: Date;
    excludeAccountIds?: ReadonlySet<number>;
}): Promise<{
    accountsProcessed: number;
    policyRowsUpserted: number;
    countryRowsUpserted: number;
    namedRowsUpserted: number;
    skippedAccountIds: number[];
}> {
    await runInsurancePolicyStatusMaintenance();

    const snapshotDate = options?.snapshotDate ?? startOfTodayUtc();
    const excludeAccountIds = options?.excludeAccountIds;
    const accounts = await prisma.account.findMany({
        where: {
            has_credit_insurance: true,
            ...(excludeAccountIds?.size
                ? { id: { notIn: [...excludeAccountIds] } }
                : {}),
        },
        select: { id: true },
    });

    let policyRowsUpserted = 0;
    let countryRowsUpserted = 0;
    let namedRowsUpserted = 0;
    const skippedAccountIds =
        excludeAccountIds && excludeAccountIds.size > 0
            ? (
                  await prisma.account.findMany({
                      where: {
                          id: { in: [...excludeAccountIds] },
                          has_credit_insurance: true,
                      },
                      select: { id: true },
                  })
              ).map((row) => row.id)
            : [];

    for (const account of accounts) {
        const leaseBlocker = await findAccountSnapshotLeaseBlocker(
            account.id,
            prisma
        );
        if (leaseBlocker) {
            warnSnapshotWriterSkippedForLease(
                "InsurancePolicyTrend",
                leaseBlocker
            );
            continue;
        }
        const result = await syncInsurancePolicyTrendSnapshotForAccount(
            account.id,
            { snapshotDate }
        );
        policyRowsUpserted += result.policyRowsUpserted;
        countryRowsUpserted += result.countryRowsUpserted;
        namedRowsUpserted += result.namedRowsUpserted;
    }

    return {
        accountsProcessed: accounts.length,
        policyRowsUpserted,
        countryRowsUpserted,
        namedRowsUpserted,
        skippedAccountIds,
    };
}

function mapHeaderRow(row: {
    snapshot_date: Date;
    policy_number: string;
    status: string;
    max_total_cover: Prisma.Decimal | null;
    cost_calculation_method: string | null;
    cost_percent: Prisma.Decimal | null;
    registration_fee_percent: Prisma.Decimal | null;
    active_customer_count: number;
    total_approved_limit: Prisma.Decimal | null;
    total_open_ar: number;
    policy_usage_pct: number | null;
    named_policy_row_count: number;
    country_row_count: number;
}): InsurancePolicyTrendPoint {
    return {
        snapshotDate: normalizeDateString(row.snapshot_date),
        policyNumber: row.policy_number,
        status: row.status,
        maxTotalCover: decimalToNumber(row.max_total_cover),
        costCalculationMethod: row.cost_calculation_method,
        costPercent: decimalToNumber(row.cost_percent),
        registrationFeePercent: decimalToNumber(row.registration_fee_percent),
        activeCustomerCount: Number(row.active_customer_count ?? 0),
        totalApprovedLimit: decimalToNumber(row.total_approved_limit),
        totalOpenAr: Number(row.total_open_ar ?? 0),
        policyUsagePct:
            row.policy_usage_pct != null
                ? Number(row.policy_usage_pct)
                : computePolicyUsagePct(
                      Number(row.total_open_ar ?? 0),
                      decimalToNumber(row.max_total_cover)
                  ),
        namedPolicyRowCount: Number(row.named_policy_row_count ?? 0),
        countryRowCount: Number(row.country_row_count ?? 0),
    };
}

export async function getInsurancePolicyTrend(
    accountId: number,
    policyId: number,
    options?: { days?: number }
): Promise<InsurancePolicyTrendResponse> {
    const safeDays = clampDays(options?.days, 90, 7, 365);
    const toDateUtc = startOfTodayUtc();
    const fromDateUtc = addUtcCalendarDays(toDateUtc, -(safeDays - 1));

    await syncInsurancePolicyTrendSnapshotForAccount(accountId, {
        policyId,
        snapshotDate: toDateUtc,
    });

    type HeaderRow = Parameters<typeof mapHeaderRow>[0];

    const rows = await prisma.$queryRaw<HeaderRow[]>`
        SELECT
            snapshot_date,
            policy_number,
            status::text AS status,
            max_total_cover,
            cost_calculation_method::text AS cost_calculation_method,
            cost_percent,
            registration_fee_percent,
            active_customer_count,
            total_approved_limit,
            total_open_ar,
            policy_usage_pct,
            named_policy_row_count,
            country_row_count
        FROM "InsurancePolicyTrend"
        WHERE account_id = ${accountId}
          AND insurance_policy_id = ${policyId}
          AND snapshot_date >= ${fromDateUtc}::date
          AND snapshot_date <= ${toDateUtc}::date
        ORDER BY snapshot_date ASC
    `;

    const series = rows.map(mapHeaderRow);

    return {
        policyId,
        fromDate: series[0]?.snapshotDate ?? null,
        toDate: series[series.length - 1]?.snapshotDate ?? null,
        latest: series[series.length - 1] ?? null,
        series,
    };
}

export async function getInsurancePolicyCountryTrend(
    accountId: number,
    policyId: number,
    options?: { countryId?: number; days?: number }
): Promise<InsurancePolicyCountryTrendResponse> {
    const safeDays = clampDays(options?.days, 90, 7, 365);
    const toDateUtc = startOfTodayUtc();
    const fromDateUtc = addUtcCalendarDays(toDateUtc, -(safeDays - 1));

    await syncInsurancePolicyTrendSnapshotForAccount(accountId, {
        policyId,
        snapshotDate: toDateUtc,
    });

    type CountryRow = {
        snapshot_date: Date;
        country_id: number;
        insurance_policy_country_id: string;
        payment_term_cap: number | null;
        country_mep: number | null;
        reporting_days: number | null;
        country_max_limit: Prisma.Decimal | null;
    };

    const rows = await prisma.$queryRaw<CountryRow[]>`
        SELECT
            snapshot_date,
            country_id,
            insurance_policy_country_id::text AS insurance_policy_country_id,
            payment_term_cap,
            country_mep,
            reporting_days,
            country_max_limit
        FROM "InsurancePolicyCountryTrend"
        WHERE account_id = ${accountId}
          AND insurance_policy_id = ${policyId}
          AND snapshot_date >= ${fromDateUtc}::date
          AND snapshot_date <= ${toDateUtc}::date
          AND (
            ${options?.countryId ?? null}::int IS NULL
            OR country_id = ${options?.countryId ?? null}
          )
        ORDER BY snapshot_date ASC, country_id ASC
    `;

    const series: InsurancePolicyCountryTrendPoint[] = rows.map((row) => ({
        snapshotDate: normalizeDateString(row.snapshot_date),
        countryId: row.country_id,
        insurancePolicyCountryId: row.insurance_policy_country_id,
        paymentTermCap: row.payment_term_cap,
        countryMep: row.country_mep,
        reportingDays: row.reporting_days,
        countryMaxLimit: decimalToNumber(row.country_max_limit),
    }));

    return {
        policyId,
        countryId: options?.countryId ?? null,
        fromDate: series[0]?.snapshotDate ?? null,
        toDate: series[series.length - 1]?.snapshotDate ?? null,
        series,
    };
}

export async function getNamedPolicyTrend(
    accountId: number,
    policyId: number,
    options?: {
        namedPolicyId?: number;
        customerNumber?: string;
        days?: number;
    }
): Promise<NamedPolicyTrendResponse> {
    const safeDays = clampDays(options?.days, 90, 7, 365);
    const toDateUtc = startOfTodayUtc();
    const fromDateUtc = addUtcCalendarDays(toDateUtc, -(safeDays - 1));
    const customerNumberFilter = options?.customerNumber?.trim() || null;

    await syncInsurancePolicyTrendSnapshotForAccount(accountId, {
        policyId,
        snapshotDate: toDateUtc,
    });

    type NamedRow = {
        snapshot_date: Date;
        named_policy_id: number;
        customer_number: string;
        max_payment_term: number | null;
        customer_mep: number | null;
        reporting_days: number | null;
        customer_max_limit: Prisma.Decimal | null;
        limit_expiration_date: Date | null;
    };

    const rows = await prisma.$queryRaw<NamedRow[]>`
        SELECT
            snapshot_date,
            named_policy_id,
            customer_number,
            max_payment_term,
            customer_mep,
            reporting_days,
            customer_max_limit,
            limit_expiration_date
        FROM "NamedPolicyTrend"
        WHERE account_id = ${accountId}
          AND insurance_policy_id = ${policyId}
          AND snapshot_date >= ${fromDateUtc}::date
          AND snapshot_date <= ${toDateUtc}::date
          AND (
            ${options?.namedPolicyId ?? null}::int IS NULL
            OR named_policy_id = ${options?.namedPolicyId ?? null}
          )
          AND (
            ${customerNumberFilter}::text IS NULL
            OR customer_number = ${customerNumberFilter}
          )
        ORDER BY snapshot_date ASC, named_policy_id ASC
    `;

    const series: NamedPolicyTrendPoint[] = rows.map((row) => ({
        snapshotDate: normalizeDateString(row.snapshot_date),
        namedPolicyId: row.named_policy_id,
        customerNumber: row.customer_number,
        maxPaymentTerm: row.max_payment_term,
        customerMep: row.customer_mep,
        reportingDays: row.reporting_days,
        customerMaxLimit: decimalToNumber(row.customer_max_limit),
        limitExpirationDate: row.limit_expiration_date
            ? normalizeDateString(row.limit_expiration_date)
            : null,
    }));

    return {
        policyId,
        namedPolicyId: options?.namedPolicyId ?? null,
        customerNumber: customerNumberFilter,
        fromDate: series[0]?.snapshotDate ?? null,
        toDate: series[series.length - 1]?.snapshotDate ?? null,
        series,
    };
}

function serializeChangeValue(value: unknown): string | number | boolean | null {
    if (value == null) {
        return null;
    }
    if (value instanceof Prisma.Decimal) {
        return value.toNumber();
    }
    if (value instanceof Date) {
        return normalizeDateString(value);
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    return String(value);
}

function diffHeaderSnapshots(
    previous: Record<string, unknown>,
    current: Record<string, unknown>
): InsurancePolicyConfigChangeField[] {
    const changes: InsurancePolicyConfigChangeField[] = [];
    for (const field of HEADER_SCALAR_FIELDS) {
        const prev = serializeChangeValue(previous[field]);
        const curr = serializeChangeValue(current[field]);
        if (prev !== curr) {
            changes.push({ field, previous: prev, current: curr });
        }
    }
    return changes;
}

export async function getInsurancePolicyConfigChanges(
    accountId: number,
    policyId: number,
    options?: { fromDate?: string; toDate?: string }
): Promise<InsurancePolicyConfigChangesResponse> {
    const toDateUtc = options?.toDate
        ? new Date(`${options.toDate}T00:00:00.000Z`)
        : startOfTodayUtc();
    const fromDateUtc = options?.fromDate
        ? new Date(`${options.fromDate}T00:00:00.000Z`)
        : addUtcCalendarDays(toDateUtc, -1);

    await syncInsurancePolicyTrendSnapshotForAccount(accountId, {
        policyId,
        snapshotDate: toDateUtc,
    });

    type HeaderSnapshotRow = Record<string, unknown> & {
        snapshot_date: Date;
    };

    const headerRows = await prisma.$queryRaw<HeaderSnapshotRow[]>`
        SELECT *
        FROM "InsurancePolicyTrend"
        WHERE account_id = ${accountId}
          AND insurance_policy_id = ${policyId}
          AND snapshot_date IN (${fromDateUtc}::date, ${toDateUtc}::date)
        ORDER BY snapshot_date ASC
    `;

    const previousHeader = headerRows.find(
        (r) => normalizeDateString(r.snapshot_date as Date) === normalizeDateString(fromDateUtc)
    );
    const currentHeader = headerRows.find(
        (r) => normalizeDateString(r.snapshot_date as Date) === normalizeDateString(toDateUtc)
    );

    const headerChanges =
        previousHeader && currentHeader
            ? diffHeaderSnapshots(previousHeader, currentHeader)
            : [];

    type ChildKeyRow = {
        snapshot_date: Date;
        country_id?: number;
        named_policy_id?: number;
    };

    const countryRows = await prisma.$queryRaw<ChildKeyRow[]>`
        SELECT snapshot_date, country_id
        FROM "InsurancePolicyCountryTrend"
        WHERE account_id = ${accountId}
          AND insurance_policy_id = ${policyId}
          AND snapshot_date IN (${fromDateUtc}::date, ${toDateUtc}::date)
    `;

    const namedRows = await prisma.$queryRaw<ChildKeyRow[]>`
        SELECT snapshot_date, named_policy_id
        FROM "NamedPolicyTrend"
        WHERE account_id = ${accountId}
          AND insurance_policy_id = ${policyId}
          AND snapshot_date IN (${fromDateUtc}::date, ${toDateUtc}::date)
    `;

    const fromCountryKey = normalizeDateString(fromDateUtc);
    const toCountryKey = normalizeDateString(toDateUtc);

    const prevCountryIds = new Set(
        countryRows
            .filter(
                (r) =>
                    normalizeDateString(r.snapshot_date) === fromCountryKey &&
                    r.country_id != null
            )
            .map((r) => r.country_id as number)
    );
    const currCountryIds = new Set(
        countryRows
            .filter(
                (r) =>
                    normalizeDateString(r.snapshot_date) === toCountryKey &&
                    r.country_id != null
            )
            .map((r) => r.country_id as number)
    );

    const prevNamedIds = new Set(
        namedRows
            .filter(
                (r) =>
                    normalizeDateString(r.snapshot_date) === fromCountryKey &&
                    r.named_policy_id != null
            )
            .map((r) => r.named_policy_id as number)
    );
    const currNamedIds = new Set(
        namedRows
            .filter(
                (r) =>
                    normalizeDateString(r.snapshot_date) === toCountryKey &&
                    r.named_policy_id != null
            )
            .map((r) => r.named_policy_id as number)
    );

    return {
        policyId,
        fromSnapshotDate: headerRows.length > 0 ? fromCountryKey : null,
        toSnapshotDate: headerRows.length > 0 ? toCountryKey : null,
        headerChanges,
        addedCountryIds: Array.from(currCountryIds).filter((id) => !prevCountryIds.has(id)),
        removedCountryIds: Array.from(prevCountryIds).filter((id) => !currCountryIds.has(id)),
        addedNamedPolicyIds: Array.from(currNamedIds).filter((id) => !prevNamedIds.has(id)),
        removedNamedPolicyIds: Array.from(prevNamedIds).filter((id) => !currNamedIds.has(id)),
    };
}
