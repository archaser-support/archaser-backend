import { Prisma } from "@prisma/client";
import { addDays, startOfDay } from "date-fns";

import { prisma } from "../domain-db";

import { convertAmountToCurrencyLatestRate } from "./customerCreditInsuranceHeaderAmounts";
import {
    isActiveTopUp,
    resolveEffectiveApprovedLimit,
} from "./resolveEffectiveApprovedLimit";

const COLLECTION_LIVE = ["Active", "Inactive"] as const;
const URGENT_EXPIRY_DAYS = 7;

export type TopUpDashboardBlock = {
    activeCoverTotal: number;
    customersWithActiveCount: number;
    expiringWithinDays: {
        customerCount: number;
        totalAmount: number;
        windowDays: number;
        urgentCustomerCount: number;
    };
    incrementalCoverTotal: number;
    coverDeclinedDueToLimit: {
        customerCount: number;
        coverLostTotal: number;
    };
};

export type TopUpPolicyUsageMetrics = {
    topUpCoverTotal: number;
    topUpCoverUsed: number;
    topUpCoverRemaining: number;
    topUpCoverOverEffective: number;
};

export type TopUpExpiringSoonAlert = {
    customerId: number;
    customerName: string | null;
    policyId: number;
    policyNumber: string | null;
    endDate: string;
};

type CustomerRow = {
    id: number;
    policy_id: number | null;
    approved_limit?: Prisma.Decimal | null;
    approved_limit_currency?: string | null;
    outdated_dcl?: boolean | null;
    excluded_from_policy?: boolean;
};

function decimalToNumber(v: Prisma.Decimal | null | undefined): number {
    if (v == null) {
        return 0;
    }
    return new Prisma.Decimal(v).toNumber();
}

function customerNameFromRow(row: {
    Person: { full_name: string | null } | null;
    Company: { name: string | null } | null;
}): string | null {
    return row.Person?.full_name || row.Company?.name || null;
}

async function convertLimitAmountToAccount(
    amount: number,
    limitCurrency: string | null | undefined,
    accountCurrency: string
): Promise<number> {
    if (!Number.isFinite(amount) || amount <= 0) {
        return 0;
    }
    const from = limitCurrency?.trim().toUpperCase() || accountCurrency;
    if (from === accountCurrency) {
        return amount;
    }
    const converted = await convertAmountToCurrencyLatestRate(
        from,
        accountCurrency,
        amount
    );
    return converted ?? amount;
}

function topUpMatchesPrimaryScope(
    parentPrimaryPolicyId: number | null | undefined,
    filterPrimaryPolicyId?: number
): boolean {
    if (filterPrimaryPolicyId == null) {
        return true;
    }
    return (
        parentPrimaryPolicyId == null ||
        parentPrimaryPolicyId === filterPrimaryPolicyId
    );
}

export async function computeTopUpDashboardMetrics(args: {
    accountId: number;
    accountCurrency: string;
    expiringWindowDays: number;
    primaryPolicyId?: number;
    customers: CustomerRow[];
    openArByCustomerId: Map<number, number>;
}): Promise<{
    topUp: TopUpDashboardBlock;
    policyUsageTopUp: TopUpPolicyUsageMetrics;
    expiringSoonAlerts: TopUpExpiringSoonAlert[];
}> {
    const today = startOfDay(new Date());
    const windowEnd = addDays(today, Math.max(0, args.expiringWindowDays));
    const urgentEnd = addDays(today, URGENT_EXPIRY_DAYS);

    let activeCoverTotal = 0;
    const customersWithActive = new Set<number>();
    const expiringCustomers = new Set<number>();
    const urgentExpiringCustomers = new Set<number>();
    let expiringTotalAmount = 0;

    let topUpCoverTotal = 0;
    let topUpCoverUsed = 0;
    let topUpCoverRemaining = 0;
    let topUpCoverOverEffective = 0;

    const expiringSoonAlerts: TopUpExpiringSoonAlert[] = [];

    for (const c of args.customers) {
        if (c.policy_id == null || c.approved_limit == null) {
            continue;
        }
        if (c.outdated_dcl === true || c.excluded_from_policy === true) {
            continue;
        }

        const resolved = await resolveEffectiveApprovedLimit(c.id, {
            baseApprovedLimit: c.approved_limit,
            baseApprovedLimitCurrency:
                c.approved_limit_currency?.trim().toUpperCase() ?? null,
            outdatedDcl: c.outdated_dcl ?? false,
            excludedFromPolicy: c.excluded_from_policy ?? false,
            asOfDate: today,
        });

        const limitCurrency =
            resolved.limitCurrency ??
            c.approved_limit_currency?.trim().toUpperCase() ??
            args.accountCurrency;

        let topUpInLimitCurrency = 0;
        for (const policyBucket of resolved.topUpByPolicy) {
            if (
                !topUpMatchesPrimaryScope(
                    policyBucket.parentPrimaryPolicyId,
                    args.primaryPolicyId
                )
            ) {
                continue;
            }
            topUpInLimitCurrency += policyBucket.policySubtotal;
        }
        if (topUpInLimitCurrency <= 0) {
            continue;
        }

        const topUpInAccount = await convertLimitAmountToAccount(
            topUpInLimitCurrency,
            limitCurrency,
            args.accountCurrency
        );
        const baseInAccount = await convertLimitAmountToAccount(
            decimalToNumber(c.approved_limit),
            limitCurrency,
            args.accountCurrency
        );

        activeCoverTotal += topUpInAccount;
        customersWithActive.add(c.id);

        const ar = args.openArByCustomerId.get(c.id) ?? 0;
        topUpCoverTotal += topUpInAccount;
        const used = Math.min(
            topUpInAccount,
            Math.max(0, ar - baseInAccount)
        );
        topUpCoverUsed += used;
        topUpCoverRemaining += Math.max(0, topUpInAccount - used);
        const effective = baseInAccount + topUpInAccount;
        if (ar > effective) {
            topUpCoverOverEffective += ar - effective;
        }

        for (const policyBucket of resolved.topUpByPolicy) {
            if (
                !topUpMatchesPrimaryScope(
                    policyBucket.parentPrimaryPolicyId,
                    args.primaryPolicyId
                )
            ) {
                continue;
            }
            for (const row of policyBucket.rows) {
                const end = startOfDay(row.endDate);
                if (end < today || end > windowEnd) {
                    continue;
                }
                const rowAmountInAccount = await convertLimitAmountToAccount(
                    row.resolvedMonetaryAmount,
                    row.currency ?? limitCurrency,
                    args.accountCurrency
                );
                if (rowAmountInAccount <= 0) {
                    continue;
                }
                expiringCustomers.add(c.id);
                expiringTotalAmount += rowAmountInAccount;
                if (end <= urgentEnd) {
                    urgentExpiringCustomers.add(c.id);
                }
            }
        }
    }

    const coverDeclined = await computeCoverDeclinedDueToLimit(
        args.accountId,
        args.accountCurrency,
        args.primaryPolicyId
    );

    topUpCoverTotal = topUpCoverUsed + topUpCoverRemaining;

    return {
        topUp: {
            activeCoverTotal,
            customersWithActiveCount: customersWithActive.size,
            expiringWithinDays: {
                customerCount: expiringCustomers.size,
                totalAmount: expiringTotalAmount,
                windowDays: args.expiringWindowDays,
                urgentCustomerCount: urgentExpiringCustomers.size,
            },
            incrementalCoverTotal: activeCoverTotal,
            coverDeclinedDueToLimit: coverDeclined,
        },
        policyUsageTopUp: {
            topUpCoverTotal,
            topUpCoverUsed,
            topUpCoverRemaining,
            topUpCoverOverEffective,
        },
        expiringSoonAlerts,
    };
}

async function computeCoverDeclinedDueToLimit(
    accountId: number,
    accountCurrency: string,
    primaryPolicyId?: number
): Promise<{ customerCount: number; coverLostTotal: number }> {
    const today = startOfDay(new Date());
    const yesterday = addDays(today, -1);

    type TrendRow = {
        customer_id: number;
        approved_limit: Prisma.Decimal | null;
        top_up_total: number | null;
    };

    const [todayRows, yesterdayRows] = await Promise.all([
        prisma.$queryRaw<TrendRow[]>`
            SELECT DISTINCT ON (customer_id)
                customer_id,
                approved_limit,
                top_up_total
            FROM "CustomerPolicyTrend"
            WHERE account_id = ${accountId}
              AND snapshot_date = ${today}::date
              AND insurance_policy_id IS NOT NULL
              ${primaryPolicyId != null ? Prisma.sql`AND insurance_policy_id = ${primaryPolicyId}` : Prisma.empty}
            ORDER BY customer_id, id DESC
        `,
        prisma.$queryRaw<TrendRow[]>`
            SELECT DISTINCT ON (customer_id)
                customer_id,
                approved_limit,
                top_up_total
            FROM "CustomerPolicyTrend"
            WHERE account_id = ${accountId}
              AND snapshot_date = ${yesterday}::date
              AND insurance_policy_id IS NOT NULL
              ${primaryPolicyId != null ? Prisma.sql`AND insurance_policy_id = ${primaryPolicyId}` : Prisma.empty}
            ORDER BY customer_id, id DESC
        `,
    ]);

    const yesterdayByCustomer = new Map(
        yesterdayRows.map((r) => [r.customer_id, r])
    );

    let customerCount = 0;
    let coverLostTotal = 0;

    for (const todayRow of todayRows) {
        const prev = yesterdayByCustomer.get(todayRow.customer_id);
        if (!prev) {
            continue;
        }
        const prevLimit = decimalToNumber(prev.approved_limit);
        const todayLimit = decimalToNumber(todayRow.approved_limit);
        const prevTopUp = Number(prev.top_up_total ?? 0);
        const todayTopUp = Number(todayRow.top_up_total ?? 0);

        if (
            todayLimit < prevLimit &&
            todayTopUp < prevTopUp &&
            prevTopUp > 0
        ) {
            customerCount += 1;
            coverLostTotal += Math.max(0, prevTopUp - todayTopUp);
        }
    }

    if (coverLostTotal > 0 && accountCurrency) {
        coverLostTotal = await convertLimitAmountToAccount(
            coverLostTotal,
            accountCurrency,
            accountCurrency
        );
    }

    return { customerCount, coverLostTotal };
}

export async function getTopUpExpiringSoonAlerts(
    accountId: number,
    withinDays: number,
    primaryPolicyId?: number,
    businessUnitFilter?: import("@prisma/client").Prisma.CustomerWhereInput
): Promise<TopUpExpiringSoonAlert[]> {
    const today = startOfDay(new Date());
    const windowEnd = addDays(today, Math.max(0, withinDays));

    const rows = await prisma.customerTopUp.findMany({
        where: {
            cancelled_at: null,
            start_date: { lte: windowEnd },
            end_date: { gte: today, lte: windowEnd },
            Customer:
                businessUnitFilter &&
                Object.keys(businessUnitFilter).length > 0
                    ? {
                          AND: [
                              {
                                  account_id: accountId,
                                  collection_status: {
                                      in: [...COLLECTION_LIVE],
                                  },
                              },
                              businessUnitFilter,
                          ],
                      }
                    : {
                          account_id: accountId,
                          collection_status: { in: [...COLLECTION_LIVE] },
                      },
            InsurancePolicy: {
                policy_kind: "TopUp",
                account_id: accountId,
                ...(primaryPolicyId != null
                    ? {
                          OR: [
                              { parent_insurance_policy_id: primaryPolicyId },
                              { parent_insurance_policy_id: null },
                          ],
                      }
                    : {}),
            },
        },
        select: {
            customer_id: true,
            end_date: true,
            insurance_policy_id: true,
            Customer: {
                select: {
                    Person: { select: { full_name: true } },
                    Company: { select: { name: true } },
                },
            },
            InsurancePolicy: {
                select: { policy_number: true, insurer_name: true },
            },
        },
        orderBy: { end_date: "asc" },
    });

    return rows.map((r) => ({
        customerId: r.customer_id,
        customerName: r.Customer ? customerNameFromRow(r.Customer) : null,
        policyId: r.insurance_policy_id,
        policyNumber: r.InsurancePolicy?.policy_number ?? null,
        endDate: startOfDay(r.end_date).toISOString().slice(0, 10),
    }));
}

export type CustomerTopUpEnrichFields = {
    has_top_up_policies: boolean;
    active_top_up_count: number;
    top_up_total: number | null;
    effective_approved_limit: number | null;
    base_approved_limit: number | null;
    has_active_top_up: boolean;
    top_up_expires_soonest: string | null;
    has_scheduled_top_up: boolean;
};

export async function enrichCustomerTopUpFields(
    customerId: number,
    accountId: number,
    policyFields: {
        approved_limit?: Prisma.Decimal | null;
        approved_limit_currency?: string | null;
        outdated_dcl?: boolean | null;
        excluded_from_policy?: boolean;
    }
): Promise<CustomerTopUpEnrichFields> {
    const accountHasTopUp = await prisma.insurancePolicy.count({
        where: { account_id: accountId, policy_kind: "TopUp" },
        take: 1,
    });

    const hasTopUpPolicies = accountHasTopUp > 0;
    if (!hasTopUpPolicies) {
        return {
            has_top_up_policies: false,
            active_top_up_count: 0,
            top_up_total: null,
            effective_approved_limit: null,
            base_approved_limit: policyFields.approved_limit
                ? decimalToNumber(policyFields.approved_limit)
                : null,
            has_active_top_up: false,
            top_up_expires_soonest: null,
            has_scheduled_top_up: false,
        };
    }

    const today = startOfDay(new Date());
    const baseLimit = policyFields.approved_limit
        ? decimalToNumber(policyFields.approved_limit)
        : null;

    const resolved = await resolveEffectiveApprovedLimit(customerId, {
        baseApprovedLimit: policyFields.approved_limit ?? null,
        baseApprovedLimitCurrency:
            policyFields.approved_limit_currency?.trim().toUpperCase() ?? null,
        outdatedDcl: policyFields.outdated_dcl ?? false,
        excludedFromPolicy: policyFields.excluded_from_policy ?? false,
        asOfDate: today,
    });

    const activeCount = resolved.topUpByPolicy.reduce(
        (sum, p) => sum + p.rows.length,
        0
    );

    const allTopUps = await prisma.customerTopUp.findMany({
        where: {
            customer_id: customerId,
            cancelled_at: null,
            InsurancePolicy: { policy_kind: "TopUp", account_id: accountId },
        },
        select: { start_date: true, end_date: true },
    });

    let soonestEnd: Date | null = null;
    let hasScheduled = false;
    for (const row of allTopUps) {
        if (
            isActiveTopUp(
                {
                    start_date: row.start_date,
                    end_date: row.end_date,
                    cancelled_at: null,
                },
                today
            )
        ) {
            const end = startOfDay(row.end_date);
            if (!soonestEnd || end < soonestEnd) {
                soonestEnd = end;
            }
        } else if (startOfDay(row.start_date) > today) {
            hasScheduled = true;
        }
    }

    return {
        has_top_up_policies: true,
        active_top_up_count: activeCount,
        top_up_total:
            resolved.topUpTotalInLimitCurrency > 0
                ? resolved.topUpTotalInLimitCurrency
                : null,
        effective_approved_limit: resolved.effectiveApprovedLimit,
        base_approved_limit: baseLimit,
        has_active_top_up: activeCount > 0,
        top_up_expires_soonest: soonestEnd
            ? soonestEnd.toISOString().slice(0, 10)
            : null,
        has_scheduled_top_up: hasScheduled,
    };
}

export type TopUpCoverReportRow = {
    customerId: number;
    customerName: string;
    policyNumber: string | null;
    baseApprovedLimit: number | null;
    topUpTotal: number;
    effectiveLimit: number | null;
    totalAR: number;
    currency: string;
};

export type TopUpExpiringReportRow = {
    customerId: number;
    customerName: string;
    policyNumber: string | null;
    topUpType: "Fixed" | "Percentage";
    topUpValue: number;
    resolvedAmount: number;
    endDate: string;
    daysLeft: number;
    currency: string;
};

function sortTopUpCoverRows(
    rows: TopUpCoverReportRow[],
    field: string,
    direction: "asc" | "desc"
): TopUpCoverReportRow[] {
    const sign = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        const av = (a as Record<string, unknown>)[field];
        const bv = (b as Record<string, unknown>)[field];
        if (typeof av === "number" && typeof bv === "number") {
            return (av - bv) * sign;
        }
        const as = String(av ?? "");
        const bs = String(bv ?? "");
        return as.localeCompare(bs) * sign;
    });
}

function sortTopUpExpiringRows(
    rows: TopUpExpiringReportRow[],
    field: string,
    direction: "asc" | "desc"
): TopUpExpiringReportRow[] {
    const sign = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        const av = (a as Record<string, unknown>)[field];
        const bv = (b as Record<string, unknown>)[field];
        if (typeof av === "number" && typeof bv === "number") {
            return (av - bv) * sign;
        }
        const as = String(av ?? "");
        const bs = String(bv ?? "");
        return as.localeCompare(bs) * sign;
    });
}

export async function getTopUpCoverReport(
    accountId: number,
    take: number,
    skip: number,
    options: {
        query?: string;
        sortField?: string;
        sortDirection?: "asc" | "desc";
        policyId?: number;
        customerId?: number;
        businessUnitFilter?: import("@prisma/client").Prisma.CustomerWhereInput;
    } = {}
): Promise<{ total: number; rows: TopUpCoverReportRow[] }> {
    const { getAccountDisplayCurrency, fetchOpenReceivableByCustomerMap } =
        await import("./creditInsuranceDashboardService");
    const { enrichCustomersWithPolicyScope } = await import(
        "./enrichCustomersWithActivePolicy"
    );

    const accountCurrency = await getAccountDisplayCurrency(accountId);
    const today = startOfDay(new Date());

    const allRaw = await prisma.customer.findMany({
        where: {
            account_id: accountId,
            collection_status: { in: [...COLLECTION_LIVE] },
            ...(options.customerId != null ? { id: options.customerId } : {}),
            ...(options.businessUnitFilter &&
            Object.keys(options.businessUnitFilter).length > 0
                ? options.businessUnitFilter
                : {}),
        },
        select: {
            id: true,
            customer_number: true,
            Person: { select: { full_name: true } },
            Company: { select: { name: true } },
        },
    });

    const [all, openArByCustomer] = await Promise.all([
        enrichCustomersWithPolicyScope(allRaw, options.policyId),
        fetchOpenReceivableByCustomerMap(accountId, options.policyId),
    ]);

    const built: TopUpCoverReportRow[] = [];
    for (const c of all) {
        if (c.policy_id == null || c.approved_limit == null) {
            continue;
        }
        if (c.outdated_dcl === true || c.excluded_from_policy === true) {
            continue;
        }

        const resolved = await resolveEffectiveApprovedLimit(c.id, {
            baseApprovedLimit: c.approved_limit,
            baseApprovedLimitCurrency:
                c.approved_limit_currency?.trim().toUpperCase() ?? null,
            outdatedDcl: c.outdated_dcl ?? false,
            excludedFromPolicy: c.excluded_from_policy ?? false,
            asOfDate: today,
        });

        if (resolved.topUpTotalInLimitCurrency <= 0) {
            continue;
        }

        const limitCurrency =
            resolved.limitCurrency ??
            c.approved_limit_currency?.trim().toUpperCase() ??
            accountCurrency;

        const topUpInAccount = await convertLimitAmountToAccount(
            resolved.topUpTotalInLimitCurrency,
            limitCurrency,
            accountCurrency
        );
        const baseInAccount = await convertLimitAmountToAccount(
            decimalToNumber(c.approved_limit),
            limitCurrency,
            accountCurrency
        );
        const effectiveInAccount =
            resolved.effectiveApprovedLimit != null
                ? await convertLimitAmountToAccount(
                      resolved.effectiveApprovedLimit,
                      limitCurrency,
                      accountCurrency
                  )
                : null;

        built.push({
            customerId: c.id,
            customerName:
                c.Person?.full_name || c.Company?.name || `#${c.id}`,
            policyNumber: c.InsurancePolicy?.policy_number ?? null,
            baseApprovedLimit: baseInAccount,
            topUpTotal: topUpInAccount,
            effectiveLimit: effectiveInAccount,
            totalAR: openArByCustomer.get(c.id) ?? 0,
            currency: accountCurrency,
        });
    }

    const q = options.query?.trim();
    let filtered = built;
    if (q) {
        const tq = q.toLowerCase();
        filtered = built.filter(
            (r) =>
                r.customerName.toLowerCase().includes(tq) ||
                (r.policyNumber || "").toLowerCase().includes(tq)
        );
    }

    const sorted = sortTopUpCoverRows(
        filtered,
        options.sortField || "topUpTotal",
        options.sortDirection || "desc"
    );
    return { total: sorted.length, rows: sorted.slice(skip, skip + take) };
}

export async function getTopUpExpiringReport(
    accountId: number,
    take: number,
    skip: number,
    options: {
        query?: string;
        sortField?: string;
        sortDirection?: "asc" | "desc";
        policyId?: number;
        customerId?: number;
        withinDays?: number;
        businessUnitFilter?: import("@prisma/client").Prisma.CustomerWhereInput;
    } = {}
): Promise<{ total: number; rows: TopUpExpiringReportRow[] }> {
    const { getAccountDisplayCurrency } = await import(
        "./creditInsuranceDashboardService"
    );
    const accountCurrency = await getAccountDisplayCurrency(accountId);
    const today = startOfDay(new Date());
    const windowDays = Math.max(1, options.withinDays ?? 30);
    const windowEnd = addDays(today, windowDays);

    const rows = await prisma.customerTopUp.findMany({
        where: {
            cancelled_at: null,
            start_date: { lte: windowEnd },
            end_date: { gte: today, lte: windowEnd },
            ...(options.customerId != null
                ? { customer_id: options.customerId }
                : {}),
            Customer: {
                account_id: accountId,
                collection_status: { in: [...COLLECTION_LIVE] },
                ...(options.businessUnitFilter &&
                Object.keys(options.businessUnitFilter).length > 0
                    ? options.businessUnitFilter
                    : {}),
            },
            InsurancePolicy: {
                policy_kind: "TopUp",
                account_id: accountId,
                ...(options.policyId != null
                    ? {
                          OR: [
                              { parent_insurance_policy_id: options.policyId },
                              { parent_insurance_policy_id: null },
                          ],
                      }
                    : {}),
            },
        },
        select: {
            customer_id: true,
            start_date: true,
            top_up_type: true,
            top_up_value: true,
            currency: true,
            end_date: true,
            InsurancePolicy: {
                select: { policy_number: true },
            },
        },
        orderBy: { end_date: "asc" },
    });

    const customerIds = Array.from(new Set(rows.map((r) => r.customer_id)));
    const { enrichCustomersWithPolicyScope } = await import(
        "./enrichCustomersWithActivePolicy"
    );
    const customersRaw = await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
            id: true,
            Person: { select: { full_name: true } },
            Company: { select: { name: true } },
        },
    });
    const enrichedCustomers = await enrichCustomersWithPolicyScope(
        customersRaw,
        options.policyId
    );
    const customerById = new Map(
        enrichedCustomers.map((customer) => [customer.id, customer])
    );

    const built: TopUpExpiringReportRow[] = [];
    for (const row of rows) {
        if (
            !isActiveTopUp(
                {
                    start_date: row.start_date,
                    end_date: row.end_date,
                    cancelled_at: null,
                },
                today
            )
        ) {
            continue;
        }
        const end = startOfDay(row.end_date);
        if (end > windowEnd) {
            continue;
        }

        const customer = customerById.get(row.customer_id);
        let resolvedAmount = 0;
        if (row.top_up_type === "Fixed") {
            resolvedAmount = decimalToNumber(row.top_up_value);
        } else if (
            customer?.approved_limit != null &&
            customer.outdated_dcl !== true &&
            customer.excluded_from_policy !== true
        ) {
            const pct = decimalToNumber(row.top_up_value);
            resolvedAmount =
                (decimalToNumber(customer.approved_limit) * pct) / 100;
        }

        const limitCurrency =
            customer?.approved_limit_currency?.trim().toUpperCase() ??
            row.currency?.trim().toUpperCase() ??
            accountCurrency;
        const resolvedInAccount = await convertLimitAmountToAccount(
            resolvedAmount,
            limitCurrency,
            accountCurrency
        );

        const daysLeft = Math.max(
            0,
            Math.ceil((end.getTime() - today.getTime()) / 86_400_000)
        );

        built.push({
            customerId: row.customer_id,
            customerName:
                customer?.Person?.full_name ||
                customer?.Company?.name ||
                `#${row.customer_id}`,
            policyNumber: row.InsurancePolicy?.policy_number ?? null,
            topUpType: row.top_up_type,
            topUpValue: decimalToNumber(row.top_up_value),
            resolvedAmount: resolvedInAccount,
            endDate: end.toISOString().slice(0, 10),
            daysLeft,
            currency: accountCurrency,
        });
    }

    const q = options.query?.trim();
    let filtered = built;
    if (q) {
        const tq = q.toLowerCase();
        filtered = built.filter(
            (r) =>
                r.customerName.toLowerCase().includes(tq) ||
                (r.policyNumber || "").toLowerCase().includes(tq)
        );
    }

    const sorted = sortTopUpExpiringRows(
        filtered,
        options.sortField || "daysLeft",
        options.sortDirection || "asc"
    );
    return { total: sorted.length, rows: sorted.slice(skip, skip + take) };
}
