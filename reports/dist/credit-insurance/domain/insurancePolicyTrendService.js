"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePolicyUsagePct = computePolicyUsagePct;
exports.syncInsurancePolicyTrendSnapshotForAccount = syncInsurancePolicyTrendSnapshotForAccount;
exports.takeInsurancePolicyTrendSnapshots = takeInsurancePolicyTrendSnapshots;
exports.getInsurancePolicyTrend = getInsurancePolicyTrend;
exports.getInsurancePolicyCountryTrend = getInsurancePolicyCountryTrend;
exports.getNamedPolicyTrend = getNamedPolicyTrend;
exports.getInsurancePolicyConfigChanges = getInsurancePolicyConfigChanges;
const client_1 = require("@prisma/client");
const domain_db_1 = require("../domain-db");
const creditInsuranceDashboardService_1 = require("./creditInsuranceDashboardService");
const hasTopUpPolicies_1 = require("./hasTopUpPolicies");
const resolveEffectiveApprovedLimit_1 = require("./resolveEffectiveApprovedLimit");
const insurancePolicyStatusCron_1 = require("./insurancePolicyStatusCron");
const insurancePolicyLifecycle_1 = require("./shared/insurancePolicyLifecycle");
const COLLECTION_LIVE = ["Active", "Inactive"];
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
];
function addUtcCalendarDays(base, days) {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}
function normalizeDateString(value) {
    return value.toISOString().slice(0, 10);
}
function decimalToNumber(value) {
    if (value == null) {
        return null;
    }
    return new client_1.Prisma.Decimal(value).toNumber();
}
/** Exported for unit tests — policy-level usage vs max_total_cover. */
function computePolicyUsagePct(totalOpenAr, maxTotalCover) {
    if (maxTotalCover == null || maxTotalCover <= 0) {
        return null;
    }
    return Math.min(999.99, (100 * totalOpenAr) / maxTotalCover);
}
function clampDays(days, defaultDays, min, max) {
    return Math.max(min, Math.min(days ?? defaultDays, max));
}
async function computePolicyRollups(accountId, policyId, maxTotalCover, snapshotDate, accountHasTopUp) {
    const activeCustomerPolicies = await domain_db_1.prisma.customerPolicy.findMany({
        where: {
            is_active: true,
            insurance_policy_id: policyId,
            Customer: {
                account_id: accountId,
                collection_status: { in: [...COLLECTION_LIVE] },
            },
        },
        select: {
            customer_id: true,
            approved_limit: true,
            approved_limit_currency: true,
        },
    });
    const openArByCustomer = await (0, creditInsuranceDashboardService_1.fetchOpenReceivableByCustomerMap)(accountId, policyId);
    let totalApprovedLimit = new client_1.Prisma.Decimal(0);
    let hasAnyLimit = false;
    let totalOpenAr = 0;
    for (const cp of activeCustomerPolicies) {
        const customerAr = Math.max(0, openArByCustomer.get(cp.customer_id) ?? 0);
        totalOpenAr += customerAr;
        let limitValue = decimalToNumber(cp.approved_limit);
        if (accountHasTopUp) {
            const resolved = await (0, resolveEffectiveApprovedLimit_1.resolveEffectiveApprovedLimit)(cp.customer_id, {
                baseApprovedLimit: cp.approved_limit,
                baseApprovedLimitCurrency: cp.approved_limit_currency?.trim().toUpperCase() ?? null,
                dbClient: domain_db_1.prisma,
                asOfDate: snapshotDate,
            });
            if (resolved?.effectiveApprovedLimit != null &&
                resolved.effectiveApprovedLimit > 0) {
                limitValue = resolved.effectiveApprovedLimit;
            }
        }
        if (limitValue != null && limitValue > 0) {
            totalApprovedLimit = totalApprovedLimit.add(limitValue);
            hasAnyLimit = true;
        }
    }
    const maxCover = decimalToNumber(maxTotalCover);
    const policyUsagePct = computePolicyUsagePct(totalOpenAr, maxCover);
    return {
        activeCustomerCount: activeCustomerPolicies.length,
        totalApprovedLimit: hasAnyLimit ? totalApprovedLimit : null,
        totalOpenAr,
        policyUsagePct,
    };
}
/**
 * Upsert daily insurance policy trend rows for one credit-insurance account.
 * When `policyId` is set, only that Primary policy is snapshotted (if effectively active).
 */
async function syncInsurancePolicyTrendSnapshotForAccount(accountId, options) {
    const snapshotDate = options?.snapshotDate ?? (0, insurancePolicyLifecycle_1.startOfTodayUtc)();
    const account = await domain_db_1.prisma.account.findUnique({
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
    const accountHasTopUp = await (0, hasTopUpPolicies_1.hasTopUpPolicies)(accountId);
    const policies = await domain_db_1.prisma.insurancePolicy.findMany({
        where: {
            account_id: accountId,
            ...(0, insurancePolicyLifecycle_1.primaryEffectivelyActivePrismaWhere)(snapshotDate),
            ...(options?.policyId != null ? { id: options.policyId } : {}),
        },
        include: {
            InsurancePolicyCountry: true,
            NamedPolicy: true,
        },
    });
    let policyRowsUpserted = 0;
    let countryRowsUpserted = 0;
    let namedRowsUpserted = 0;
    for (const policy of policies) {
        const rollups = await computePolicyRollups(accountId, policy.id, policy.max_total_cover, snapshotDate, accountHasTopUp);
        const countryCount = policy.InsurancePolicyCountry.length;
        const namedCount = policy.NamedPolicy.length;
        await domain_db_1.prisma.$executeRaw `
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
                country_row_count
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
                ${rollups.activeCustomerCount},
                ${rollups.totalApprovedLimit},
                ${rollups.totalOpenAr},
                ${rollups.policyUsagePct},
                ${namedCount},
                ${countryCount}
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
                active_customer_count = EXCLUDED.active_customer_count,
                total_approved_limit = EXCLUDED.total_approved_limit,
                total_open_ar = EXCLUDED.total_open_ar,
                policy_usage_pct = EXCLUDED.policy_usage_pct,
                named_policy_row_count = EXCLUDED.named_policy_row_count,
                country_row_count = EXCLUDED.country_row_count,
                modified_at = NOW()
        `;
        policyRowsUpserted += 1;
        for (const countryRow of policy.InsurancePolicyCountry) {
            await domain_db_1.prisma.$executeRaw `
                INSERT INTO "InsurancePolicyCountryTrend" (
                    account_id,
                    insurance_policy_id,
                    insurance_policy_country_id,
                    country_id,
                    snapshot_date,
                    payment_term_cap,
                    country_mep,
                    reporting_days,
                    country_max_limit
                ) VALUES (
                    ${accountId},
                    ${policy.id},
                    ${countryRow.id}::uuid,
                    ${countryRow.country_id},
                    ${snapshotDate}::date,
                    ${countryRow.payment_term_cap},
                    ${countryRow.country_mep},
                    ${countryRow.reporting_days},
                    ${countryRow.country_max_limit}
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
            await domain_db_1.prisma.$executeRaw `
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
                    limit_expiration_date
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
                    ${namedRow.limit_expiration_date}
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
async function takeInsurancePolicyTrendSnapshots(options) {
    await (0, insurancePolicyStatusCron_1.runInsurancePolicyStatusMaintenance)();
    const snapshotDate = options?.snapshotDate ?? (0, insurancePolicyLifecycle_1.startOfTodayUtc)();
    const accounts = await domain_db_1.prisma.account.findMany({
        where: { has_credit_insurance: true },
        select: { id: true },
    });
    let policyRowsUpserted = 0;
    let countryRowsUpserted = 0;
    let namedRowsUpserted = 0;
    for (const account of accounts) {
        const result = await syncInsurancePolicyTrendSnapshotForAccount(account.id, { snapshotDate });
        policyRowsUpserted += result.policyRowsUpserted;
        countryRowsUpserted += result.countryRowsUpserted;
        namedRowsUpserted += result.namedRowsUpserted;
    }
    return {
        accountsProcessed: accounts.length,
        policyRowsUpserted,
        countryRowsUpserted,
        namedRowsUpserted,
    };
}
function mapHeaderRow(row) {
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
        policyUsagePct: row.policy_usage_pct != null
            ? Number(row.policy_usage_pct)
            : computePolicyUsagePct(Number(row.total_open_ar ?? 0), decimalToNumber(row.max_total_cover)),
        namedPolicyRowCount: Number(row.named_policy_row_count ?? 0),
        countryRowCount: Number(row.country_row_count ?? 0),
    };
}
async function getInsurancePolicyTrend(accountId, policyId, options) {
    const safeDays = clampDays(options?.days, 90, 7, 365);
    const toDateUtc = (0, insurancePolicyLifecycle_1.startOfTodayUtc)();
    const fromDateUtc = addUtcCalendarDays(toDateUtc, -(safeDays - 1));
    await syncInsurancePolicyTrendSnapshotForAccount(accountId, {
        policyId,
        snapshotDate: toDateUtc,
    });
    const rows = await domain_db_1.prisma.$queryRaw `
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
async function getInsurancePolicyCountryTrend(accountId, policyId, options) {
    const safeDays = clampDays(options?.days, 90, 7, 365);
    const toDateUtc = (0, insurancePolicyLifecycle_1.startOfTodayUtc)();
    const fromDateUtc = addUtcCalendarDays(toDateUtc, -(safeDays - 1));
    await syncInsurancePolicyTrendSnapshotForAccount(accountId, {
        policyId,
        snapshotDate: toDateUtc,
    });
    const rows = await domain_db_1.prisma.$queryRaw `
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
    const series = rows.map((row) => ({
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
async function getNamedPolicyTrend(accountId, policyId, options) {
    const safeDays = clampDays(options?.days, 90, 7, 365);
    const toDateUtc = (0, insurancePolicyLifecycle_1.startOfTodayUtc)();
    const fromDateUtc = addUtcCalendarDays(toDateUtc, -(safeDays - 1));
    const customerNumberFilter = options?.customerNumber?.trim() || null;
    await syncInsurancePolicyTrendSnapshotForAccount(accountId, {
        policyId,
        snapshotDate: toDateUtc,
    });
    const rows = await domain_db_1.prisma.$queryRaw `
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
    const series = rows.map((row) => ({
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
function serializeChangeValue(value) {
    if (value == null) {
        return null;
    }
    if (value instanceof client_1.Prisma.Decimal) {
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
function diffHeaderSnapshots(previous, current) {
    const changes = [];
    for (const field of HEADER_SCALAR_FIELDS) {
        const prev = serializeChangeValue(previous[field]);
        const curr = serializeChangeValue(current[field]);
        if (prev !== curr) {
            changes.push({ field, previous: prev, current: curr });
        }
    }
    return changes;
}
async function getInsurancePolicyConfigChanges(accountId, policyId, options) {
    const toDateUtc = options?.toDate
        ? new Date(`${options.toDate}T00:00:00.000Z`)
        : (0, insurancePolicyLifecycle_1.startOfTodayUtc)();
    const fromDateUtc = options?.fromDate
        ? new Date(`${options.fromDate}T00:00:00.000Z`)
        : addUtcCalendarDays(toDateUtc, -1);
    await syncInsurancePolicyTrendSnapshotForAccount(accountId, {
        policyId,
        snapshotDate: toDateUtc,
    });
    const headerRows = await domain_db_1.prisma.$queryRaw `
        SELECT *
        FROM "InsurancePolicyTrend"
        WHERE account_id = ${accountId}
          AND insurance_policy_id = ${policyId}
          AND snapshot_date IN (${fromDateUtc}::date, ${toDateUtc}::date)
        ORDER BY snapshot_date ASC
    `;
    const previousHeader = headerRows.find((r) => normalizeDateString(r.snapshot_date) === normalizeDateString(fromDateUtc));
    const currentHeader = headerRows.find((r) => normalizeDateString(r.snapshot_date) === normalizeDateString(toDateUtc));
    const headerChanges = previousHeader && currentHeader
        ? diffHeaderSnapshots(previousHeader, currentHeader)
        : [];
    const countryRows = await domain_db_1.prisma.$queryRaw `
        SELECT snapshot_date, country_id
        FROM "InsurancePolicyCountryTrend"
        WHERE account_id = ${accountId}
          AND insurance_policy_id = ${policyId}
          AND snapshot_date IN (${fromDateUtc}::date, ${toDateUtc}::date)
    `;
    const namedRows = await domain_db_1.prisma.$queryRaw `
        SELECT snapshot_date, named_policy_id
        FROM "NamedPolicyTrend"
        WHERE account_id = ${accountId}
          AND insurance_policy_id = ${policyId}
          AND snapshot_date IN (${fromDateUtc}::date, ${toDateUtc}::date)
    `;
    const fromCountryKey = normalizeDateString(fromDateUtc);
    const toCountryKey = normalizeDateString(toDateUtc);
    const prevCountryIds = new Set(countryRows
        .filter((r) => normalizeDateString(r.snapshot_date) === fromCountryKey &&
        r.country_id != null)
        .map((r) => r.country_id));
    const currCountryIds = new Set(countryRows
        .filter((r) => normalizeDateString(r.snapshot_date) === toCountryKey &&
        r.country_id != null)
        .map((r) => r.country_id));
    const prevNamedIds = new Set(namedRows
        .filter((r) => normalizeDateString(r.snapshot_date) === fromCountryKey &&
        r.named_policy_id != null)
        .map((r) => r.named_policy_id));
    const currNamedIds = new Set(namedRows
        .filter((r) => normalizeDateString(r.snapshot_date) === toCountryKey &&
        r.named_policy_id != null)
        .map((r) => r.named_policy_id));
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
