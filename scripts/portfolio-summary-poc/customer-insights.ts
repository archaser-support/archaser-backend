/**
 * Portfolio summary POC — per-customer insights for the data bundle:
 * recurring term breaches (issued terms over policy max / paid late past MEP),
 * cash-terms customers and their premium, cash customers paying late,
 * act-now deadlines, payer trend, late reporting and concentration.
 *
 * Definitions follow `.cursor/plans/portfolio-summary-poc.prd.md`
 * (Customer insights — definitions). Invoice premium reuses the dashboard's
 * Actual Sales cost slices so the cash saving reconciles with the Costs section.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import {
    applyOpenArVatBasis,
    expandCreditPoolRootsToMembers,
    fetchPolicyConcentrationSnapshots,
    normalizePolicyExclusionReason,
    portfolioRootCustomerIdsWhere,
} from "@archaser/credit-insurance-domain";
import { computePaymentTermBreach } from "../../packages/credit-insurance-domain/src/credit-insurance/domain/invoiceInsuranceFields";

import {
    RANGE_COST_EXCLUDED_INVOICE_STATUSES,
    computeActualSalesInvoiceCostSlice,
    computeRegistrationFeeCostSlice,
} from "../../api/src/credit-insurance/domain/portfolioRangeCost";
import { customerDisplayNameFromParts } from "../../api/src/customers/domain/customerAggregatedData";

export const INSIGHT_RULES = {
    recurringBreachSharePct: 50,
    recurringMinInvoices: 3,
    steadySpreadDays: 15,
    worseningDeltaDays: 15,
    disputeLinkedSharePct: 50,
    cashCustomerSharePct: 90,
    mixedCustomerMinSharePct: 10,
    recommendedTermsCoveragePercentile: 75,
    termBuckets: [30, 45, 60, 75, 90, 120, 150, 180],
    /** Deadlines snap to month-end cutoffs, so 30 days always spans the next cutoff. */
    actNowDays: 30,
    limitExpiryDays: 60,
    listSize: 5,
} as const;

const DAY_MS = 86_400_000;
const CLOSED_STATUSES = new Set<string>([
    "Paid",
    ...RANGE_COST_EXCLUDED_INVOICE_STATUSES,
]);

type CptInvoiceDayRow = {
    snapshot_date: Date;
    customer_id: number;
    insurance_policy_id: number | null;
    cost_calculation_method: "Limit" | "ActualSales" | null;
    cost_percent: Prisma.Decimal | number | null;
    registration_fee_percent: Prisma.Decimal | number | null;
    excluded_from_policy: boolean;
    outdated_dcl: boolean;
    policy_exclusion_reason: string | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    payment_term_cutoff_day: number | null;
    payment_term_substitute_day: number | null;
    reporting_days: number | null;
};

type InvoiceFact = {
    customerId: number;
    invoiceDate: string;
    month: string;
    amount: number;
    inScope: boolean;
    isCash: boolean;
    creditDays: number | null;
    policyMaxPaymentTerm: number | null;
    mep: number | null;
    typeA: boolean;
    typeB: boolean;
    paid: boolean;
    daysToPay: number | null;
    daysLate: number | null;
    disputed: boolean;
    mepFlag: boolean;
    /** Days the customer was already past MEP when this invoice was issued. */
    createdAtMepDaysPast: number | null;
    dueDate: Date | null;
    paymentCutoffDay: number | null;
    paymentSubstituteDay: number | null;
    reportingBreach: boolean;
    premium: number;
};

export type TermSensitivityRow = {
    days: number;
    invoiceCount: number;
    amount: number;
    customerCount: number;
    improvementPct: number;
};

export type TermSensitivityTable = {
    currentDays: number;
    exampleCustomerName: string | null;
    exampleAmount: number;
    rows: TermSensitivityRow[];
};

/** Standing template chapter: how breach count and amount change as days increase. */
export type TermSensitivity = {
    paymentTerms: TermSensitivityTable & { clearingDays: number | null };
    createdAtMep: TermSensitivityTable;
    reporting: TermSensitivityTable & { asOf: string };
};

type CustomerInfo = { name: string; customerNumber: string | null };

function ymd(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function utcDay(ymdValue: string): Date {
    return new Date(`${ymdValue}T00:00:00.000Z`);
}

function dayDiff(later: Date, earlier: Date): number {
    return Math.round((later.getTime() - earlier.getTime()) / DAY_MS);
}

function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * DAY_MS);
}

function num(value: Prisma.Decimal | number | string | null | undefined): number | null {
    if (value == null) {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function percentile(values: number[], p: number): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const rank = (p / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function share(part: number, whole: number): number {
    return whole > 0 ? (part / whole) * 100 : 0;
}

function mode(values: number[]): number | null {
    const counts = new Map<number, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    let best: number | null = null;
    let bestCount = 0;
    for (const [value, count] of counts) {
        if (count > bestCount) {
            best = value;
            bestCount = count;
        }
    }
    return best;
}

/**
 * Suggest raising the customer assignment only when it is still below the
 * policy max. At the policy max, the only remaining step is insurer approval
 * for the days actually issued.
 */
function typeATermsAction(input: {
    customerName: string;
    customerMax: number | null;
    accountMax: number | null;
    issued: number | null;
}): {
    customerBelowPolicyMax: boolean;
    actionTitle: string;
    actionText: string;
    causeNote: string;
} {
    const below =
        input.customerMax != null &&
        input.accountMax != null &&
        input.customerMax < input.accountMax;
    if (below && input.accountMax != null) {
        const issuedBeyond =
            input.issued != null && input.issued > input.accountMax;
        return {
            customerBelowPolicyMax: true,
            actionTitle: `להתאים את תנאי האשראי של ${input.customerName}`,
            actionText: issuedBeyond
                ? `תנאי הלקוח (${input.customerMax} ימים) נמוכים ממקסימום הפוליסה. לעדכן במערכת ל־${input.accountMax} ימים, ולקבל מהמבטח אישור ל־${input.issued} ימים.`
                : `תנאי הלקוח (${input.customerMax} ימים) נמוכים ממקסימום הפוליסה. לעדכן במערכת ל־${input.accountMax} ימים.`,
            causeNote:
                "תנאי הלקוח במערכת נמוכים ממקסימום הפוליסה, ולכן אפשר להעלות אותם בלי אישור המבטח.",
        };
    }
    return {
        customerBelowPolicyMax: false,
        actionTitle: `לבקש מהמבטח לאשר ${input.issued ?? ""} ימי אשראי ל${input.customerName}`,
        actionText: `תנאי הלקוח כבר ${input.customerMax ?? "—"} ימים, שזה מקסימום הפוליסה. החשבוניות מונפקות ל־${input.issued ?? "—"} ימים, והאישור לזה צריך לבוא מהמבטח.`,
        causeNote:
            "תנאי הלקוח במערכת כבר במקסימום הפוליסה, והחשבוניות מונפקות מעבר לזה.",
    };
}

/** Smallest term bucket so that p75 days-to-pay lands inside terms + MEP. */
function recommendTermsDays(
    daysToPay: number[],
    mep: number | null
): number | null {
    const p = percentile(
        daysToPay,
        INSIGHT_RULES.recommendedTermsCoveragePercentile
    );
    if (p == null) {
        return null;
    }
    const needed = Math.max(0, Math.ceil(p - (mep ?? 0)));
    return (
        INSIGHT_RULES.termBuckets.find((bucket) => bucket >= needed) ??
        INSIGHT_RULES.termBuckets[INSIGHT_RULES.termBuckets.length - 1]
    );
}

function isWorsening(trend: ReturnType<typeof monthlyDelayTrend>): boolean {
    return (
        trend.deltaDays != null &&
        trend.lastAvgDaysLate != null &&
        trend.deltaDays >= INSIGHT_RULES.worseningDeltaDays &&
        trend.lastAvgDaysLate > 0
    );
}

function monthlyDelayTrend(facts: InvoiceFact[]): {
    months: Array<{ month: string; medianDaysLate: number }>;
    deltaDays: number | null;
    lastAvgDaysLate: number | null;
} {
    const byMonth = new Map<string, number[]>();
    for (const fact of facts) {
        if (fact.daysLate == null) {
            continue;
        }
        const list = byMonth.get(fact.month) ?? [];
        list.push(fact.daysLate);
        byMonth.set(fact.month, list);
    }
    const months = [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, values]) => ({
            month,
            medianDaysLate: percentile(values, 50) ?? 0,
        }));
    if (months.length < 4) {
        return { months, deltaDays: null, lastAvgDaysLate: null };
    }
    const first = (months[0].medianDaysLate + months[1].medianDaysLate) / 2;
    const last =
        (months[months.length - 1].medianDaysLate +
            months[months.length - 2].medianDaysLate) /
        2;
    return { months, deltaDays: last - first, lastAvgDaysLate: last };
}

async function loadCustomers(
    prisma: PrismaClient,
    accountId: number
): Promise<Map<number, CustomerInfo>> {
    const rows = await prisma.customer.findMany({
        where: { account_id: accountId },
        select: {
            id: true,
            customer_number: true,
            Company: { select: { name: true } },
            Person: {
                select: { full_name: true, first_name: true, last_name: true },
            },
        },
    });
    return new Map(
        rows.map((row) => [
            row.id,
            {
                name: customerDisplayNameFromParts({
                    companyName: row.Company?.name,
                    personFullName: row.Person?.full_name,
                    personFirstName: row.Person?.first_name,
                    personLastName: row.Person?.last_name,
                    customerNumber: row.customer_number,
                }),
                customerNumber: row.customer_number,
            },
        ])
    );
}

async function loadNamedCustomerIds(
    prisma: PrismaClient,
    accountId: number,
    from: Date,
    to: Date
): Promise<Set<number>> {
    const rows = await prisma.$queryRaw<Array<{ customer_id: number }>>`
        SELECT DISTINCT t.customer_id
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date >= ${from}::date
          AND t.snapshot_date <= ${to}::date
          AND t.insurance_policy_id IS NOT NULL
          AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
          AND t.limit_type::text = 'Named'
        UNION
        SELECT DISTINCT c.id AS customer_id
        FROM "NamedPolicy" np
        INNER JOIN "InsurancePolicy" p ON p.id = np.insurance_policy_id
        INNER JOIN "Customer" c
            ON c.account_id = p.account_id
           AND c.customer_number = np.customer_number
        WHERE p.account_id = ${accountId}
    `;
    return new Set(rows.map((row) => row.customer_id));
}

function paymentTermClearsAt(fact: InvoiceFact, maxDays: number): boolean {
    if (!fact.dueDate) {
        return true;
    }
    return !computePaymentTermBreach(
        utcDay(fact.invoiceDate),
        fact.dueDate,
        maxDays,
        {
            invoiceDate: utcDay(fact.invoiceDate),
            cutoffDayOfMonth: fact.paymentCutoffDay,
            substituteDayOfMonth: fact.paymentSubstituteDay,
        },
        fact.amount
    );
}

/** Smallest payment-term cap that clears this invoice, or 401 when 400 still breaches. */
function smallestClearingPaymentTerm(fact: InvoiceFact): number {
    if (paymentTermClearsAt(fact, 0)) {
        return 0;
    }
    if (!paymentTermClearsAt(fact, 400)) {
        return 401;
    }
    let low = 0;
    let high = 400;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (paymentTermClearsAt(fact, mid)) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    return low;
}

function dayLadder(current: number, extras: number[], cap: number): number[] {
    const days = new Set<number>([current]);
    for (const extra of extras) {
        const day = current + extra;
        if (day > current && day <= cap) {
            days.add(day);
        }
    }
    return [...days].sort((a, b) => a - b);
}

function sensitivityRows(
    days: number[],
    baselineAmount: number,
    measure: (day: number) => { invoiceCount: number; amount: number; customerCount: number }
): TermSensitivityRow[] {
    return days.map((day) => {
        const measured = measure(day);
        const improvementPct =
            baselineAmount > 0
                ? ((baselineAmount - measured.amount) / baselineAmount) * 100
                : 0;
        return { days: day, ...measured, improvementPct };
    });
}

function largestExample(
    rows: Array<{ customerId: number; amount: number }>,
    nameOf: (customerId: number) => string
): { name: string | null; amount: number } {
    const byCustomer = new Map<number, number>();
    for (const row of rows) {
        byCustomer.set(row.customerId, (byCustomer.get(row.customerId) ?? 0) + row.amount);
    }
    const top = [...byCustomer.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) {
        return { name: null, amount: 0 };
    }
    return { name: nameOf(top[0]), amount: top[1] };
}

/**
 * Template chapter for every account and range. Payment terms name the
 * smallest cap that clears every breach, at most 180. Created-at-MEP and
 * reporting show the curve and do not name a day count.
 */
async function buildTermSensitivity(
    prisma: PrismaClient,
    args: {
        accountId: number;
        today: Date;
        amountsIncludeVat: boolean;
        accountPolicyMaxPaymentTerm: number | null;
        facts: InvoiceFact[];
        rootOf: (customerId: number) => number;
        nameOf: (customerId: number) => string;
        openAmount: (row: {
            outstanding_debt: number | null;
            amount: number | null;
            amount_without_vat: number | null;
        }) => number;
    }
): Promise<TermSensitivity> {
    const scoped = args.facts.filter((fact) => fact.inScope);
    const paymentCurrent =
        mode(
            scoped.flatMap((fact) =>
                fact.policyMaxPaymentTerm == null ? [] : [fact.policyMaxPaymentTerm]
            )
        ) ?? args.accountPolicyMaxPaymentTerm;
    const paymentFacts =
        paymentCurrent == null ? [] : scoped.filter((fact) => fact.dueDate != null);
    const clearingByInvoice = paymentFacts.map((fact) => ({
        fact,
        clearsAt: smallestClearingPaymentTerm(fact),
    }));
    const paymentBaseline = clearingByInvoice.filter(
        (row) => paymentCurrent != null && row.clearsAt > paymentCurrent
    );
    const paymentClearingRaw =
        paymentBaseline.length === 0
            ? null
            : Math.max(...paymentBaseline.map((row) => row.clearsAt));
    const paymentClearing =
        paymentClearingRaw != null && paymentClearingRaw <= 180
            ? paymentClearingRaw
            : null;
    const paymentDayList =
        paymentCurrent == null
            ? []
            : [
                  ...new Set([
                      ...dayLadder(paymentCurrent, [10, 30, 60], 180),
                      ...(paymentClearing != null ? [paymentClearing] : []),
                      180,
                  ]),
              ].sort((a, b) => a - b);
    const paymentExample = largestExample(
        paymentBaseline.map((row) => ({
            customerId: row.fact.customerId,
            amount: row.fact.amount,
        })),
        args.nameOf
    );
    const paymentAmountAt = (day: number) =>
        sum(
            clearingByInvoice
                .filter((row) => row.clearsAt > day)
                .map((row) => row.fact.amount)
        );

    const mepCurrent =
        mode(
            scoped.flatMap((fact) =>
                fact.mepFlag && fact.mep != null ? [fact.mep] : []
            )
        ) ?? mode(scoped.flatMap((fact) => (fact.mep == null ? [] : [fact.mep])));
    const mepFacts = scoped.filter((fact) => fact.mepFlag);
    const mepStill = (fact: InvoiceFact, day: number) => {
        if (fact.createdAtMepDaysPast == null || fact.mep == null) {
            return true;
        }
        return fact.createdAtMepDaysPast > day - fact.mep;
    };
    const mepBaseline =
        mepCurrent == null ? [] : mepFacts.filter((fact) => mepStill(fact, mepCurrent));
    const mepExample = largestExample(
        mepBaseline.map((fact) => ({ customerId: fact.customerId, amount: fact.amount })),
        args.nameOf
    );

    const openUnreported = await prisma.invoice.findMany({
        where: {
            account_id: args.accountId,
            customer_id: { not: null },
            status: { notIn: [...CLOSED_STATUSES] as never[] },
            outstanding_debt: { gt: 0 },
            amount: { gt: 0 },
            actual_reporting_date: null,
            target_reporting_date: { lt: args.today },
        },
        select: {
            customer_id: true,
            target_reporting_date: true,
            outstanding_debt: true,
            amount: true,
            amount_without_vat: true,
        },
    });
    const policyLinks = await prisma.customerPolicy.findMany({
        where: {
            is_active: true,
            insurance_policy_id: { not: null },
            Customer: { account_id: args.accountId },
        },
        select: { customer_id: true, reporting_days: true },
    });
    const reportingDaysByCustomer = new Map<number, number>();
    for (const link of policyLinks) {
        if (link.reporting_days == null) {
            continue;
        }
        const rootId = args.rootOf(link.customer_id);
        if (!reportingDaysByCustomer.has(rootId)) {
            reportingDaysByCustomer.set(rootId, link.reporting_days);
        }
    }
    const reportingCurrent = mode([...reportingDaysByCustomer.values()]);
    const reportingRows = openUnreported.flatMap((row) => {
        if (row.target_reporting_date == null || row.customer_id == null) {
            return [];
        }
        const customerId = args.rootOf(row.customer_id);
        const ownDays = reportingDaysByCustomer.get(customerId) ?? reportingCurrent;
        if (ownDays == null) {
            return [];
        }
        return [
            {
                customerId,
                amount: args.openAmount(row),
                daysPast: dayDiff(args.today, row.target_reporting_date),
                ownDays,
            },
        ];
    });
    const reportingBookDays = reportingCurrent ?? reportingRows[0]?.ownDays ?? null;
    const reportingStill = (
        row: { daysPast: number; ownDays: number },
        day: number
    ) => row.daysPast > day - row.ownDays;
    const reportingBaseline =
        reportingBookDays == null
            ? []
            : reportingRows.filter((row) => reportingStill(row, reportingBookDays));
    const reportingClearsAt =
        reportingBookDays == null
            ? null
            : (() => {
                  const left = (day: number) =>
                      reportingRows.some((row) => reportingStill(row, day));
                  if (!left(reportingBookDays)) {
                      return reportingBookDays;
                  }
                  if (left(180)) {
                      return null;
                  }
                  let low = reportingBookDays;
                  let high = 180;
                  while (low < high) {
                      const mid = Math.floor((low + high) / 2);
                      if (left(mid)) {
                          low = mid + 1;
                      } else {
                          high = mid;
                      }
                  }
                  return low;
              })();
    const reportingDays =
        reportingBookDays == null
            ? []
            : [
                  ...new Set([
                      ...dayLadder(reportingBookDays, [15, 30, 45, 60], 180),
                      ...(reportingClearsAt != null ? [reportingClearsAt] : []),
                  ]),
              ].sort((a, b) => a - b);
    const reportingExample = largestExample(reportingBaseline, args.nameOf);

    const countCustomers = (customerIds: number[]) => new Set(customerIds).size;

    return {
        paymentTerms: {
            currentDays: paymentCurrent ?? 0,
            clearingDays:
                paymentClearing != null && paymentClearing !== paymentCurrent
                    ? paymentClearing
                    : null,
            exampleCustomerName: paymentExample.name,
            exampleAmount: paymentExample.amount,
            rows:
                paymentCurrent == null
                    ? []
                    : sensitivityRows(paymentDayList, paymentAmountAt(paymentCurrent), (day) => {
                          const left = clearingByInvoice.filter((row) => row.clearsAt > day);
                          return {
                              invoiceCount: left.length,
                              amount: sum(left.map((row) => row.fact.amount)),
                              customerCount: countCustomers(left.map((row) => row.fact.customerId)),
                          };
                      }),
        },
        createdAtMep: {
            currentDays: mepCurrent ?? 0,
            exampleCustomerName: mepExample.name,
            exampleAmount: mepExample.amount,
            rows:
                mepCurrent == null
                    ? []
                    : sensitivityRows(
                          dayLadder(mepCurrent, [5, 15, 30, 60, 90], 180),
                          sum(mepBaseline.map((fact) => fact.amount)),
                          (day) => {
                              const left = mepFacts.filter((fact) => mepStill(fact, day));
                              return {
                                  invoiceCount: left.length,
                                  amount: sum(left.map((fact) => fact.amount)),
                                  customerCount: countCustomers(
                                      left.map((fact) => fact.customerId)
                                  ),
                              };
                          }
                      ),
        },
        reporting: {
            asOf: ymd(args.today),
            currentDays: reportingBookDays ?? 0,
            exampleCustomerName: reportingExample.name,
            exampleAmount: reportingExample.amount,
            rows:
                reportingBookDays == null
                    ? []
                    : sensitivityRows(
                          reportingDays,
                          sum(reportingBaseline.map((row) => row.amount)),
                          (day) => {
                              const left = reportingRows.filter((row) =>
                                  reportingStill(row, day)
                              );
                              return {
                                  invoiceCount: left.length,
                                  amount: sum(left.map((row) => row.amount)),
                                  customerCount: countCustomers(
                                      left.map((row) => row.customerId)
                                  ),
                              };
                          }
                      ),
        },
    };
}

export async function buildCustomerInsights(
    prisma: PrismaClient,
    args: {
        accountId: number;
        from: string;
        to: string;
        annualCreditAssessmentFee: number | null;
        maxTotalCover: number | null;
        costsInsurancePlusRegistration: number | null;
        /** Insurance-policy max payment term (days), not the customer's assignment. */
        accountPolicyMaxPaymentTerm: number | null;
    }
) {
    const fromUtc = utcDay(args.from);
    const toUtc = utcDay(args.to);
    const today = utcDay(ymd(new Date()));

    const [account, customers, namedIds] = await Promise.all([
        prisma.account.findUnique({
            where: { id: args.accountId },
            select: { amounts_include_vat: true },
        }),
        loadCustomers(prisma, args.accountId),
        loadNamedCustomerIds(prisma, args.accountId, fromUtc, toUtc),
    ]);
    const amountsIncludeVat = account?.amounts_include_vat !== false;
    const vatAmount = (row: {
        amount: number | null;
        amount_without_vat: number | null;
    }) =>
        applyOpenArVatBasis(amountsIncludeVat, num(row.amount) ?? 0, {
            amount: num(row.amount),
            amount_without_vat: num(row.amount_without_vat),
        });
    const nameOf = (customerId: number) =>
        customers.get(customerId)?.name ?? String(customerId);

    // Same pool attribution as the Costs section: linked-child invoices are
    // analyzed and priced on their credit-pool root.
    const rootIds = (
        await prisma.customer.findMany({
            where: portfolioRootCustomerIdsWhere(args.accountId),
            select: { id: true },
        })
    ).map((row) => row.id);
    const pool = await expandCreditPoolRootsToMembers(args.accountId, rootIds);

    const invoiceRows = await prisma.invoice.findMany({
        where: {
            account_id: args.accountId,
            customer_id: { in: pool.memberIds },
            invoice_date: { gte: fromUtc, lte: toUtc },
            status: { notIn: [...RANGE_COST_EXCLUDED_INVOICE_STATUSES] },
        },
        select: {
            customer_id: true,
            invoice_date: true,
            due_date: true,
            close_date: true,
            status: true,
            amount: true,
            amount_without_vat: true,
            payment_term: true,
            ctv_payment_term: true,
            ctv_customer_overdue_mep: true,
            ctv_customer_overdue_mep_days_past: true,
            target_mep_date: true,
            reporting_breach: true,
            mep_ignored: true,
            DisputeInvoice: { select: { id: true }, take: 1 },
        },
    });

    const rootOf = (customerId: number) =>
        pool.rootByMemberId.get(customerId) ?? customerId;
    const invoiceCustomerIds = [
        ...new Set(invoiceRows.map((row) => rootOf(row.customer_id as number))),
    ];
    const invoiceDates = [
        ...new Set(invoiceRows.map((row) => ymd(row.invoice_date))),
    ].map(utcDay);
    const cptRows =
        invoiceRows.length === 0
            ? []
            : await prisma.$queryRaw<CptInvoiceDayRow[]>`
                SELECT
                    t.snapshot_date,
                    t.customer_id,
                    t.insurance_policy_id,
                    t.cost_calculation_method,
                    t.cost_percent,
                    t.registration_fee_percent,
                    t.excluded_from_policy,
                    t.outdated_dcl,
                    t.policy_exclusion_reason,
                    t.max_payment_term,
                    t.max_allowed_mep,
                    t.payment_term_cutoff_day,
                    t.payment_term_substitute_day,
                    t.reporting_days
                FROM "CustomerPolicyTrend" t
                WHERE t.account_id = ${args.accountId}
                  AND t.customer_id = ANY(${invoiceCustomerIds}::int[])
                  AND t.snapshot_date IN (${Prisma.join(invoiceDates)})
                ORDER BY t.snapshot_date ASC, t.customer_id ASC
            `;
    const cptByCustomerDay = new Map<string, CptInvoiceDayRow>();
    for (const row of cptRows) {
        cptByCustomerDay.set(`${row.customer_id}|${ymd(row.snapshot_date)}`, row);
    }

    let premiumCheckTotal = 0;
    const facts: InvoiceFact[] = [];
    for (const row of invoiceRows) {
        const customerId = rootOf(row.customer_id as number);
        const invoiceDate = ymd(row.invoice_date);
        const amount = vatAmount(row);
        const cpt = cptByCustomerDay.get(`${customerId}|${invoiceDate}`);
        const approved =
            cpt != null &&
            cpt.insurance_policy_id != null &&
            !normalizePolicyExclusionReason(cpt.policy_exclusion_reason);

        let premium = 0;
        if (approved && cpt && !cpt.excluded_from_policy && !cpt.outdated_dcl) {
            const sales = computeActualSalesInvoiceCostSlice({
                amount,
                costPercent: num(cpt.cost_percent),
                costCalculationMethod: cpt.cost_calculation_method,
            });
            premium =
                sales +
                computeRegistrationFeeCostSlice({
                    insurancePremium: sales,
                    registrationFeePercent: num(cpt.registration_fee_percent),
                });
        }
        premiumCheckTotal += premium;

        if (amount <= 0) {
            continue;
        }

        const due = row.due_date;
        const close = row.close_date;
        const creditDays = due
            ? dayDiff(due, row.invoice_date)
            : (row.payment_term ?? null);
        const isCash = due
            ? ymd(due) === invoiceDate
            : row.payment_term === 0;
        const mep = cpt?.max_allowed_mep ?? null;
        const paid = close != null && row.status === "Paid";
        const isOpen = !CLOSED_STATUSES.has(row.status);

        const mepDeadline =
            row.target_mep_date ??
            (due && mep != null ? addDays(due, mep) : null);
        let typeB = false;
        if (!row.mep_ignored && mepDeadline && mepDeadline <= toUtc) {
            typeB = close != null ? close > mepDeadline : isOpen;
        }

        let daysLate: number | null = null;
        if (due) {
            if (close != null) {
                daysLate = dayDiff(close, due);
            } else if (isOpen && due <= toUtc) {
                daysLate = dayDiff(toUtc, due);
            }
        }

        facts.push({
            customerId,
            invoiceDate,
            month: invoiceDate.slice(0, 7),
            amount,
            inScope: approved,
            isCash,
            creditDays,
            policyMaxPaymentTerm: cpt?.max_payment_term ?? null,
            mep,
            typeA: row.ctv_payment_term,
            typeB,
            paid,
            daysToPay: close != null ? dayDiff(close, row.invoice_date) : null,
            daysLate,
            disputed: row.DisputeInvoice.length > 0,
            mepFlag: row.ctv_customer_overdue_mep,
            createdAtMepDaysPast: row.ctv_customer_overdue_mep
                ? row.ctv_customer_overdue_mep_days_past
                : null,
            dueDate: due,
            paymentCutoffDay: cpt?.payment_term_cutoff_day ?? null,
            paymentSubstituteDay: cpt?.payment_term_substitute_day ?? null,
            reportingBreach: row.reporting_breach,
            premium,
        });
    }

    const factsByCustomer = new Map<number, InvoiceFact[]>();
    for (const fact of facts) {
        const list = factsByCustomer.get(fact.customerId) ?? [];
        list.push(fact);
        factsByCustomer.set(fact.customerId, list);
    }

    // ── Recurring term breaches ────────────────────────────────────────
    const typeA: unknown[] = [];
    const typeB: Array<Record<string, unknown> & { breachedAmount: number }> =
        [];
    const worsening: Array<Record<string, unknown> & { amount: number }> = [];
    const causeCounts: Record<string, number> = {
        disputeLinked: 0,
        worsening: 0,
        steadySlowPayer: 0,
        erratic: 0,
    };
    let typeACustomerCount = 0;
    let typeAAmount = 0;

    for (const [customerId, all] of factsByCustomer) {
        const scoped = all.filter((fact) => fact.inScope);
        if (scoped.length < INSIGHT_RULES.recurringMinInvoices) {
            continue;
        }
        const totalAmount = sum(scoped.map((fact) => fact.amount));
        const mep = mode(
            scoped.flatMap((fact) => (fact.mep == null ? [] : [fact.mep]))
        );
        const policyMax = mode(
            scoped.flatMap((fact) =>
                fact.policyMaxPaymentTerm == null
                    ? []
                    : [fact.policyMaxPaymentTerm]
            )
        );
        const trend = monthlyDelayTrend(scoped);
        const paidDaysToPay = scoped.flatMap((fact) =>
            fact.paid && fact.daysToPay != null ? [fact.daysToPay] : []
        );
        const paidDaysLate = scoped.flatMap((fact) =>
            fact.paid && fact.daysLate != null ? [fact.daysLate] : []
        );

        if (isWorsening(trend)) {
            worsening.push({
                customerId,
                customerName: nameOf(customerId),
                invoiceCount: scoped.length,
                amount: totalAmount,
                firstMonth: trend.months[0].month,
                firstMonthMedianDaysLate: trend.months[0].medianDaysLate,
                lastMonth: trend.months[trend.months.length - 1].month,
                lastMonthMedianDaysLate:
                    trend.months[trend.months.length - 1].medianDaysLate,
                deltaDays: trend.deltaDays,
                lastAvgDaysLate: trend.lastAvgDaysLate,
            });
        }

        const aBreached = scoped.filter((fact) => fact.typeA);
        const aSharePct = share(aBreached.length, scoped.length);
        if (aSharePct >= INSIGHT_RULES.recurringBreachSharePct) {
            typeACustomerCount += 1;
            const breachedAmount = sum(aBreached.map((fact) => fact.amount));
            typeAAmount += breachedAmount;
            typeA.push({
                customerId,
                customerName: nameOf(customerId),
                invoiceCount: scoped.length,
                breachedInvoiceCount: aBreached.length,
                breachedSharePct: aSharePct,
                breachedAmount,
                issuedCreditDays: mode(
                    aBreached.flatMap((fact) =>
                        fact.creditDays == null ? [] : [fact.creditDays]
                    )
                ),
                policyMaxPaymentTerm: policyMax,
                accountPolicyMaxPaymentTerm: args.accountPolicyMaxPaymentTerm,
                ...typeATermsAction({
                    customerName: nameOf(customerId),
                    customerMax: policyMax,
                    accountMax: args.accountPolicyMaxPaymentTerm,
                    issued: mode(
                        aBreached.flatMap((fact) =>
                            fact.creditDays == null ? [] : [fact.creditDays]
                        )
                    ),
                }),
                cause: "termsSetup",
            });
        }

        const bBreached = scoped.filter((fact) => fact.typeB);
        const bSharePct = share(bBreached.length, scoped.length);
        if (bSharePct < INSIGHT_RULES.recurringBreachSharePct) {
            continue;
        }
        const p25 = percentile(paidDaysLate, 25);
        const p75 = percentile(paidDaysLate, 75);
        const spreadDays = p25 != null && p75 != null ? p75 - p25 : null;
        const disputedSharePct = share(
            bBreached.filter((fact) => fact.disputed).length,
            bBreached.length
        );
        let cause: keyof typeof causeCounts = "erratic";
        if (disputedSharePct >= INSIGHT_RULES.disputeLinkedSharePct) {
            cause = "disputeLinked";
        } else if (isWorsening(trend)) {
            cause = "worsening";
        } else if (
            paidDaysLate.length >= INSIGHT_RULES.recurringMinInvoices &&
            spreadDays != null &&
            spreadDays <= INSIGHT_RULES.steadySpreadDays
        ) {
            cause = "steadySlowPayer";
        }
        causeCounts[cause] += 1;
        const recommendedTermsDays =
            cause === "steadySlowPayer"
                ? recommendTermsDays(paidDaysToPay, mep)
                : null;
        typeB.push({
            customerId,
            customerName: nameOf(customerId),
            invoiceCount: scoped.length,
            breachedInvoiceCount: bBreached.length,
            breachedSharePct: bSharePct,
            breachedAmount: sum(bBreached.map((fact) => fact.amount)),
            totalAmount,
            currentCreditDays: percentile(
                scoped.flatMap((fact) =>
                    fact.creditDays == null ? [] : [fact.creditDays]
                ),
                50
            ),
            medianDaysToPay: percentile(paidDaysToPay, 50),
            medianDaysLate: percentile(paidDaysLate, 50),
            spreadDays,
            disputedSharePct,
            trendDeltaDays: trend.deltaDays,
            mep,
            policyMaxPaymentTerm: policyMax,
            cause,
            recommendedTermsDays,
            recommendedTermsExceedPolicyMax:
                recommendedTermsDays != null &&
                policyMax != null &&
                recommendedTermsDays > policyMax,
        });
    }
    typeB.sort((a, b) => b.breachedAmount - a.breachedAmount);
    worsening.sort((a, b) => b.amount - a.amount);
    (typeA as Array<{ breachedAmount: number }>).sort(
        (a, b) => b.breachedAmount - a.breachedAmount
    );
    const steadyPayers = typeB.filter(
        (row) => row.cause === "steadySlowPayer"
    );

    // ── Cash-terms customers ───────────────────────────────────────────
    type CashRow = {
        customerId: number;
        customerName: string;
        invoiceCount: number;
        amount: number;
        cashAmount: number;
        cashSharePct: number;
        cashPremium: number;
        named: boolean;
        typeBSharePct: number;
        cashInvoiceCount: number;
        medianDaysToPay: number | null;
        spreadDaysToPay: number | null;
        mepFlaggedAmount: number;
        mep: number | null;
    };
    const cashCustomers: CashRow[] = [];
    const mixedCustomers: CashRow[] = [];
    for (const [customerId, all] of factsByCustomer) {
        const amount = sum(all.map((fact) => fact.amount));
        const cashFacts = all.filter((fact) => fact.isCash);
        const cashAmount = sum(cashFacts.map((fact) => fact.amount));
        const cashSharePct = share(cashAmount, amount);
        if (cashSharePct < INSIGHT_RULES.mixedCustomerMinSharePct) {
            continue;
        }
        const cashDaysToPay = cashFacts.flatMap((fact) =>
            fact.paid && fact.daysToPay != null ? [fact.daysToPay] : []
        );
        const p25 = percentile(cashDaysToPay, 25);
        const p75 = percentile(cashDaysToPay, 75);
        const row: CashRow = {
            customerId,
            customerName: nameOf(customerId),
            invoiceCount: all.length,
            amount,
            cashAmount,
            cashSharePct,
            cashPremium: sum(cashFacts.map((fact) => fact.premium)),
            named: namedIds.has(customerId),
            typeBSharePct: share(
                cashFacts.filter((fact) => fact.typeB).length,
                cashFacts.length
            ),
            cashInvoiceCount: cashFacts.length,
            medianDaysToPay: percentile(cashDaysToPay, 50),
            spreadDaysToPay: p25 != null && p75 != null ? p75 - p25 : null,
            mepFlaggedAmount: sum(
                all.filter((fact) => fact.mepFlag).map((fact) => fact.amount)
            ),
            mep: mode(all.flatMap((fact) => (fact.mep == null ? [] : [fact.mep]))),
        };
        if (cashSharePct >= INSIGHT_RULES.cashCustomerSharePct) {
            cashCustomers.push(row);
        } else {
            mixedCustomers.push(row);
        }
    }
    cashCustomers.sort((a, b) => b.cashPremium - a.cashPremium);
    mixedCustomers.sort((a, b) => b.cashAmount - a.cashAmount);

    const cashPremium = sum(cashCustomers.map((row) => row.cashPremium));
    const cashNamedCount = cashCustomers.filter((row) => row.named).length;
    const cashAssessment =
        cashNamedCount * (args.annualCreditAssessmentFee ?? 0);

    const cashLate = [...cashCustomers, ...mixedCustomers]
        .filter(
            (row) =>
                row.cashInvoiceCount >= INSIGHT_RULES.recurringMinInvoices &&
                row.typeBSharePct >= INSIGHT_RULES.recurringBreachSharePct &&
                // Cash terms (due = invoice) but actual payment is later.
                row.medianDaysToPay != null &&
                row.medianDaysToPay > 0
        )
        .map((row) => {
            const steady =
                row.spreadDaysToPay != null &&
                row.spreadDaysToPay <= INSIGHT_RULES.steadySpreadDays;
            const daysToPay = (factsByCustomer.get(row.customerId) ?? [])
                .filter((fact) => fact.isCash && fact.paid)
                .flatMap((fact) =>
                    fact.daysToPay == null ? [] : [fact.daysToPay]
                );
            // Always size terms from actual payment dates — cash labels in the
            // ERP do not mean they pay on the invoice date.
            const recommendedTermsDays = recommendTermsDays(daysToPay, row.mep);
            const pattern = steady ? "steady" : "erratic";
            const recommendation =
                recommendedTermsDays != null
                    ? pattern === "steady"
                        ? `משלם באיחור קבוע ← לתת ${recommendedTermsDays} ימי אשראי או לאכוף גבייה`
                        : `משלם אחרי תאריך החשבונית ← לתת ${recommendedTermsDays} ימי אשראי או לאכוף גבייה`
                    : "משלם אחרי תאריך החשבונית ← לתת ימי אשראי או לאכוף גבייה";
            return {
                ...row,
                pattern,
                recommendedTermsDays,
                recommendation,
            };
        })
        .sort((a, b) => b.mepFlaggedAmount - a.mepFlaggedAmount);

    // ── Late reporting ─────────────────────────────────────────────────
    const scopedFacts = facts.filter((fact) => fact.inScope);
    const inScopeRootIds = new Set(scopedFacts.map((fact) => fact.customerId));
    const inScopeMemberIds = pool.memberIds.filter((memberId) =>
        inScopeRootIds.has(rootOf(memberId))
    );
    const lateReported = scopedFacts.filter((fact) => fact.reportingBreach);
    const lateByCustomer = new Map<number, { count: number; amount: number }>();
    for (const fact of lateReported) {
        const entry = lateByCustomer.get(fact.customerId) ?? {
            count: 0,
            amount: 0,
        };
        entry.count += 1;
        entry.amount += fact.amount;
        lateByCustomer.set(fact.customerId, entry);
    }

    // ── Act-now list (as of generation date): already past deadlines ───
    const openWhere = {
        account_id: args.accountId,
        customer_id: { not: null },
        status: { notIn: [...CLOSED_STATUSES] as never[] },
        outstanding_debt: { gt: 0 },
    };
    const [mepPast, reportingPast, expiringLimits, limitLinks] =
        await Promise.all([
            prisma.invoice.findMany({
                where: {
                    ...openWhere,
                    mep_ignored: false,
                    target_mep_date: { lt: today },
                },
                select: {
                    id: true,
                    customer_id: true,
                    outstanding_debt: true,
                    amount: true,
                    amount_without_vat: true,
                },
            }),
            prisma.invoice.findMany({
                where: {
                    ...openWhere,
                    actual_reporting_date: null,
                    target_reporting_date: { lt: today },
                },
                select: {
                    id: true,
                    customer_id: true,
                    outstanding_debt: true,
                    amount: true,
                    amount_without_vat: true,
                },
            }),
            prisma.customerPolicy.findMany({
                where: {
                    is_active: true,
                    insurance_policy_id: { not: null },
                    approved_limit: { gt: 0 },
                    approved_limit_expiration_date: {
                        gte: today,
                        lte: addDays(today, INSIGHT_RULES.limitExpiryDays),
                    },
                    Customer: { account_id: args.accountId },
                },
                select: {
                    customer_id: true,
                    approved_limit: true,
                    approved_limit_expiration_date: true,
                },
                orderBy: { approved_limit: "desc" },
            }),
            prisma.customerPolicy.findMany({
                where: {
                    is_active: true,
                    insurance_policy_id: { not: null },
                    approved_limit: { gt: 0 },
                    Customer: { account_id: args.accountId },
                },
                select: { approved_limit_expiration_date: true },
            }),
        ]);
    const openAmount = (row: {
        outstanding_debt: number | null;
        amount: number | null;
        amount_without_vat: number | null;
    }) =>
        applyOpenArVatBasis(
            amountsIncludeVat,
            Math.max(0, num(row.outstanding_debt) ?? 0),
            {
                amount: num(row.amount),
                amount_without_vat: num(row.amount_without_vat),
            }
        );
    type OpenDeadlineRow = {
        id: number;
        customer_id: number | null;
        outstanding_debt: number | null;
        amount: number | null;
        amount_without_vat: number | null;
    };
    const summarizeOpen = (rows: OpenDeadlineRow[]) => {
        const byCustomer = new Map<number, { count: number; amount: number }>();
        for (const row of rows) {
            const rootId = rootOf(row.customer_id as number);
            const entry = byCustomer.get(rootId) ?? { count: 0, amount: 0 };
            entry.count += 1;
            entry.amount += openAmount(row);
            byCustomer.set(rootId, entry);
        }
        const top = [...byCustomer.entries()]
            .sort(([, a], [, b]) => b.amount - a.amount)
            .slice(0, INSIGHT_RULES.listSize)
            .map(([customerId, entry]) => ({
                customerId,
                customerName: nameOf(customerId),
                ...entry,
            }));
        return {
            invoiceCount: rows.length,
            customerCount: byCustomer.size,
            amount: sum([...byCustomer.values()].map((entry) => entry.amount)),
            topCustomers: top,
            exampleCustomer: top[0] ?? {
                customerId: 0,
                customerName: "—",
                count: 0,
                amount: 0,
            },
        };
    };
    /** Unique open invoices past MEP and/or reporting (one amount each). */
    const lateById = new Map<number, OpenDeadlineRow>();
    for (const row of mepPast) {
        lateById.set(row.id, row);
    }
    for (const row of reportingPast) {
        if (!lateById.has(row.id)) {
            lateById.set(row.id, row);
        }
    }
    const lateDeadlines = summarizeOpen([...lateById.values()]);
    const mepDeadlines = summarizeOpen(mepPast);
    const reportingDeadlines = summarizeOpen(reportingPast);

    // ── Payer trend (invoices paid in range, in-scope customers) ───────
    const paidInRange = await prisma.invoice.findMany({
        where: {
            account_id: args.accountId,
            customer_id: { in: [...inScopeMemberIds] },
            status: "Paid",
            close_date: { gte: fromUtc, lte: toUtc },
            due_date: { not: null },
        },
        select: {
            invoice_date: true,
            due_date: true,
            close_date: true,
            amount: true,
            amount_without_vat: true,
        },
    });
    const payerMonths = new Map<
        string,
        { count: number; weight: number; toPay: number; late: number }
    >();
    for (const row of paidInRange) {
        const amount = vatAmount(row);
        if (amount <= 0 || !row.close_date || !row.due_date) {
            continue;
        }
        const month = ymd(row.close_date).slice(0, 7);
        const entry = payerMonths.get(month) ?? {
            count: 0,
            weight: 0,
            toPay: 0,
            late: 0,
        };
        entry.count += 1;
        entry.weight += amount;
        entry.toPay += amount * dayDiff(row.close_date, row.invoice_date);
        entry.late += amount * dayDiff(row.close_date, row.due_date);
        payerMonths.set(month, entry);
    }
    const payerTrendMonthly = [...payerMonths.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, entry]) => ({
            month,
            paidInvoiceCount: entry.count,
            paidAmount: entry.weight,
            avgDaysToPay: entry.toPay / entry.weight,
            avgDaysLate: entry.late / entry.weight,
        }));

    // ── Concentration (range end snapshot) ─────────────────────────────
    const concentrationRows = await fetchPolicyConcentrationSnapshots({
        accountId: args.accountId,
        fromDate: args.from,
        toDate: args.to,
        includeNoPolicyExposure: false,
    });
    const concentration = concentrationRows
        .sort((a, b) => b.totalOpenAr - a.totalOpenAr)
        .slice(0, 1)
        .map((row) => {
            const top5 = row.ranking.slice(0, 5);
            const top5OpenAr = sum(top5.map((entry) => entry.openAr));
            return {
                policyId: row.policyId,
                policyNumber: row.policyNumber,
                asOfDate: row.asOfDate,
                totalOpenAr: row.totalOpenAr,
                customersWithOpenAr: row.customersWithOpenAr,
                top1CustomerName: row.top1CustomerName,
                top1OpenAr: row.ranking[0]?.openAr ?? 0,
                top1SharePct: row.top1SharePct,
                top5OpenAr,
                top5SharePct: share(top5OpenAr, row.totalOpenAr),
                top5Customers: top5,
                maxTotalCover: args.maxTotalCover,
                totalOpenArToMaxCoverPct:
                    args.maxTotalCover != null
                        ? share(row.totalOpenAr, args.maxTotalCover)
                        : null,
                top5OpenArToMaxCoverPct:
                    args.maxTotalCover != null
                        ? share(top5OpenAr, args.maxTotalCover)
                        : null,
            };
        })[0] ?? null;

    const scopedAmount = sum(scopedFacts.map((fact) => fact.amount));
    const list = <T>(rows: T[]) => rows.slice(0, INSIGHT_RULES.listSize);

    return {
        rules: INSIGHT_RULES,
        generatedAsOf: ymd(today),
        invoiceCount: facts.length,
        inScopeInvoiceCount: scopedFacts.length,
        inScopeAmount: scopedAmount,
        premiumCheck: {
            invoicePremiumTotal: premiumCheckTotal,
            costsInsurancePlusRegistration: args.costsInsurancePlusRegistration,
            differencePct:
                args.costsInsurancePlusRegistration
                    ? share(
                          premiumCheckTotal - args.costsInsurancePlusRegistration,
                          args.costsInsurancePlusRegistration
                      )
                    : null,
        },
        recurringBreach: {
            typeA: {
                customerCount: typeACustomerCount,
                breachedAmount: typeAAmount,
                customers: list(typeA),
            },
            typeB: {
                customerCount: typeB.length,
                breachedAmount: sum(typeB.map((row) => row.breachedAmount)),
                breachedSharePctOfInScope: share(
                    sum(typeB.map((row) => row.breachedAmount)),
                    scopedAmount
                ),
                causeCounts,
                customers: list(typeB),
                steadyPayers: list(steadyPayers),
                steadyPayerCount: steadyPayers.length,
            },
        },
        cash: {
            customerCount: cashCustomers.length,
            cashSales: sum(cashCustomers.map((row) => row.cashAmount)),
            premium: cashPremium,
            namedCount: cashNamedCount,
            assessmentFee: cashAssessment,
            totalSaving: cashPremium + cashAssessment,
            customers: list(cashCustomers),
            mixed: {
                customerCount: mixedCustomers.length,
                cashSales: sum(mixedCustomers.map((row) => row.cashAmount)),
                cashPremium: sum(mixedCustomers.map((row) => row.cashPremium)),
                customers: list(mixedCustomers),
            },
        },
        cashPayingLate: {
            customerCount: cashLate.length,
            mepFlaggedAmount: sum(cashLate.map((row) => row.mepFlaggedAmount)),
            steadyCount: cashLate.filter((row) => row.pattern === "steady").length,
            customers: list(cashLate),
        },
        actNow: {
            asOf: ymd(today),
            /** @deprecated upcoming window removed — past deadlines only (D10/D15). */
            horizonDays: INSIGHT_RULES.actNowDays,
            lateDeadlines,
            mepDeadlines,
            reportingDeadlines,
            expiringLimits: {
                horizonDays: INSIGHT_RULES.limitExpiryDays,
                activeLimitCount: limitLinks.length,
                withExpirationDateCount: limitLinks.filter(
                    (row) => row.approved_limit_expiration_date != null
                ).length,
                count: expiringLimits.length,
                totalLimit: sum(
                    expiringLimits.map((row) => num(row.approved_limit) ?? 0)
                ),
                top: list(
                    expiringLimits.map((row) => ({
                        customerId: rootOf(row.customer_id),
                        customerName: nameOf(rootOf(row.customer_id)),
                        approvedLimit: num(row.approved_limit) ?? 0,
                        expirationDate: row.approved_limit_expiration_date
                            ? ymd(row.approved_limit_expiration_date)
                            : null,
                    }))
                ),
            },
        },
        payerTrend: {
            monthly: payerTrendMonthly,
            worseningCount: worsening.length,
            worsening: list(worsening),
        },
        lateReporting: {
            invoiceCount: lateReported.length,
            amount: sum(lateReported.map((fact) => fact.amount)),
            sharePctOfInScope: share(
                sum(lateReported.map((fact) => fact.amount)),
                scopedAmount
            ),
            customerCount: lateByCustomer.size,
            topCustomers: list(
                [...lateByCustomer.entries()]
                    .sort(([, a], [, b]) => b.amount - a.amount)
                    .map(([customerId, entry]) => ({
                        customerId,
                        customerName: nameOf(customerId),
                        ...entry,
                    }))
            ),
        },
        concentration,
        termSensitivity: await buildTermSensitivity(prisma, {
            accountId: args.accountId,
            today,
            amountsIncludeVat,
            accountPolicyMaxPaymentTerm: args.accountPolicyMaxPaymentTerm,
            facts,
            rootOf,
            nameOf,
            openAmount,
        }),
    };
}

type ViolationReasonRow = {
    reason: string;
    amount: number;
    sharePct: number;
    /** Distinct root customers with this breach type in the range. */
    customerCount: number;
    exampleCustomerId: number;
    exampleCustomerName: string;
    exampleAmount: number;
    /** Managerial fix hint; paymentTerm may be customized per example customer. */
    fixHint: string;
};

const DEFAULT_BREACH_FIX_HINTS: Record<string, string> = {
    customerOverdueMep: "לגבות או לדווח — כבר אחרי מועד ה־MEP",
    paymentTerm: "להתאים את תנאי האשראי במערכת למקסימום הפוליסה",
    reportingBreach: "לתקן דיווח למבטח בזמן",
    outdatedDcl: "לחדש או לבדוק מסגרת DCL",
    invoiceAfterPolicyEnd: "להפסיק הנפקה אחרי סיום הפוליסה / להעביר כיסוי",
    other: "לבדוק את סיבת ההפרה",
};

/**
 * Terms-breach share breakdown for the Policy violations card (same sum-of-
 * daily `terms_breach_by_reason` basis as the dashboard leading-cause KPI),
 * plus customer count and the largest-amount example customer per reason.
 */
export async function buildViolationReasonBreakdown(
    prisma: PrismaClient,
    args: {
        accountId: number;
        from: string;
        to: string;
        /** Account policy max payment term (days); used for paymentTerm fix hints. */
        policyMaxPaymentTerm?: number | null;
    }
): Promise<ViolationReasonRow[]> {
    const fromUtc = utcDay(args.from);
    const toUtc = utcDay(args.to);
    const pendingReviewLiteral = "pending review";
    // Same root-customer scope as getCreditPortfolioHealth, so shares match
    // the dashboard "Share of total violations" KPI.
    const rootIds = (
        await prisma.customer.findMany({
            where: portfolioRootCustomerIdsWhere(args.accountId),
            select: { id: true },
        })
    ).map((row) => row.id);

    const rows = await prisma.$queryRaw<
        Array<{ reason_key: string; customer_id: number; amount: number }>
    >`
        SELECT
            e.key AS reason_key,
            t.customer_id,
            COALESCE(SUM((e.value->>'amount')::float8), 0)::float8 AS amount
        FROM "CustomerPolicyTrend" t
        CROSS JOIN LATERAL jsonb_each(
            CASE
                WHEN jsonb_typeof(COALESCE(t.terms_breach_by_reason, '{}'::jsonb)) = 'object'
                THEN COALESCE(t.terms_breach_by_reason, '{}'::jsonb)
                ELSE '{}'::jsonb
            END
        ) AS e(key, value)
        WHERE t.account_id = ${args.accountId}
          AND t.snapshot_date >= ${fromUtc}::date
          AND t.snapshot_date <= ${toUtc}::date
          AND t.customer_id = ANY(${rootIds}::int[])
          AND t.insurance_policy_id IS NOT NULL
          AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
          AND (
            COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
        GROUP BY e.key, t.customer_id
        HAVING COALESCE(SUM((e.value->>'amount')::float8), 0) > 0
    `;

    const customers = await loadCustomers(prisma, args.accountId);
    const pool = await expandCreditPoolRootsToMembers(args.accountId, rootIds);
    const rootOf = (customerId: number) =>
        pool.rootByMemberId.get(customerId) ?? customerId;
    const nameOf = (customerId: number) =>
        customers.get(customerId)?.name ?? String(customerId);

    const byReason = new Map<
        string,
        { total: number; byCustomer: Map<number, number> }
    >();
    for (const row of rows) {
        const reason = row.reason_key?.trim();
        if (!reason || !(row.amount > 0)) {
            continue;
        }
        const rootId = rootOf(row.customer_id);
        const entry = byReason.get(reason) ?? {
            total: 0,
            byCustomer: new Map<number, number>(),
        };
        entry.total += row.amount;
        entry.byCustomer.set(
            rootId,
            (entry.byCustomer.get(rootId) ?? 0) + row.amount
        );
        byReason.set(reason, entry);
    }

    const grandTotal = sum([...byReason.values()].map((entry) => entry.total));
    const baseRows = [...byReason.entries()]
        .map(([reason, entry]) => {
            const example = [...entry.byCustomer.entries()].sort(
                ([, a], [, b]) => b - a
            )[0];
            return {
                reason,
                amount: entry.total,
                sharePct: share(entry.total, grandTotal),
                customerCount: entry.byCustomer.size,
                exampleCustomerId: example?.[0] ?? 0,
                exampleCustomerName: example ? nameOf(example[0]) : "—",
                exampleAmount: example?.[1] ?? 0,
                fixHint:
                    DEFAULT_BREACH_FIX_HINTS[reason] ??
                    DEFAULT_BREACH_FIX_HINTS.other,
            };
        })
        .sort((a, b) => b.sharePct - a.sharePct);

    const paymentTermRow = baseRows.find((row) => row.reason === "paymentTerm");
    const policyMax = args.policyMaxPaymentTerm ?? null;
    if (paymentTermRow && paymentTermRow.exampleCustomerId > 0) {
        const exampleId = paymentTermRow.exampleCustomerId;
        const examplePool = await expandCreditPoolRootsToMembers(args.accountId, [
            exampleId,
        ]);
        const memberIds =
            examplePool.memberIds.length > 0
                ? examplePool.memberIds
                : [exampleId];
        const [cpt, invoices] = await Promise.all([
            prisma.customerPolicy.findFirst({
                where: {
                    customer_id: { in: memberIds },
                    is_active: true,
                },
                orderBy: { id: "desc" },
                select: { max_payment_term: true },
            }),
            prisma.invoice.findMany({
                where: {
                    account_id: args.accountId,
                    customer_id: { in: memberIds },
                    invoice_date: {
                        gte: utcDay(args.from),
                        lte: utcDay(args.to),
                    },
                },
                select: {
                    invoice_date: true,
                    due_date: true,
                },
                take: 5000,
            }),
        ]);
        const issuedDays = invoices
            .filter((inv) => inv.due_date && inv.invoice_date)
            .map((inv) => dayDiff(inv.due_date!, inv.invoice_date));
        const issuedCreditDays = mode(issuedDays);
        const customerMax = cpt?.max_payment_term ?? null;
        // Already at (or above) the policy ceiling — cannot raise local max;
        // ask the insurer to approve the terms they actually issue.
        if (
            policyMax != null &&
            customerMax != null &&
            customerMax >= policyMax &&
            issuedCreditDays != null &&
            issuedCreditDays > policyMax
        ) {
            paymentTermRow.fixHint = `לבקש מהמבטח ${issuedCreditDays} ימי אשראי ללקוח — כבר במקסימום הפוליסה (${policyMax})`;
        } else if (
            policyMax != null &&
            customerMax != null &&
            customerMax >= policyMax
        ) {
            paymentTermRow.fixHint =
                "לבקש מהמבטח להגדיל ימי אשראי ללקוח — כבר במקסימום הפוליסה";
        }
    }

    return baseRows;
}
