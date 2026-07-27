import { addDays, addMonths, differenceInCalendarDays } from "date-fns";
import { Prisma, type invoice_status } from "@prisma/client";

import { computeOutdatedDclAtEvaluation } from "./customerOutdatedDcl";
import { readUninsuredAmountForDisplay, storedCapacityGapAmount } from "./policyGapAmounts";
import { isCustomerPolicyExcluded } from "./policyExclusion";

/**
 * Parse import/API date values as a local calendar day (avoids UTC off-by-one on YYYY-MM-DD).
 * Used for invoice import and insurance date math.
 */
export function parseImportDateToLocalCalendarDate(
    value: unknown
): Date | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    const s = String(value).trim();
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (ymd) {
        const y = parseInt(ymd[1], 10);
        const mo = parseInt(ymd[2], 10) - 1;
        const d = parseInt(ymd[3], 10);
        const dt = new Date(y, mo, d);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(s);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * Calendar-day credit term: days from invoice_date to due_date.
 */
export function computePaymentTermDays(
    invoiceDate: Date | null | undefined,
    dueDate: Date | null | undefined
): number | null {
    if (!invoiceDate || !dueDate) {
        return null;
    }
    return differenceInCalendarDays(dueDate, invoiceDate);
}

export function addCalendarDaysToDate(
    base: Date | null | undefined,
    days: number | null | undefined
): Date | null {
    if (!base || days === null || days === undefined) {
        return null;
    }
    return addDays(base, days);
}

export type MonthEndCutoffOptions = {
    invoiceDate?: Date | null | undefined;
    cutoffDayOfMonth?: number | null | undefined;
    substituteDayOfMonth?: number | null | undefined;
};

function calendarDayOfMonthForCutoff(d: Date): number {
    return normalizeCalendarDayForInsuranceCompare(d).getDate();
}

function calendarYearAndMonth(d: Date): { year: number; month: number } {
    const norm = normalizeCalendarDayForInsuranceCompare(d);
    return { year: norm.getFullYear(), month: norm.getMonth() };
}

/** UTC calendar midnight — matches Prisma `@db.Date` persistence. */
function utcCalendarDate(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month, day));
}

function lastDayOfUtcCalendarMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Substitute anchor: `substituteDayOfMonth` in the calendar month immediately
 * after `referenceDate`'s month (clamp to month length).
 */
function substituteAnchorInMonthAfter(
    referenceDate: Date,
    substituteDayOfMonth: number
): Date {
    const { year, month } = calendarYearAndMonth(referenceDate);
    let targetYear = year;
    let targetMonth = month + 1;
    if (targetMonth > 11) {
        targetMonth = 0;
        targetYear += 1;
    }
    const targetDay = Math.min(
        substituteDayOfMonth,
        lastDayOfUtcCalendarMonth(targetYear, targetMonth)
    );
    return utcCalendarDate(targetYear, targetMonth, targetDay);
}

/**
 * Calendar days from `invoice_date` to the substitute day in the month after the
 * invoice month when issue day-of-month is on or after cutoff; otherwise null.
 */
export function computeMonthEndCutoffDiffIfApplicable(args: {
    invoiceDate: Date | null | undefined;
    cutoffDayOfMonth: number | null | undefined;
    substituteDayOfMonth: number | null | undefined;
}): number | null {
    const { invoiceDate, cutoffDayOfMonth, substituteDayOfMonth } = args;
    if (
        cutoffDayOfMonth == null ||
        substituteDayOfMonth == null ||
        invoiceDate == null
    ) {
        return null;
    }
    if (calendarDayOfMonthForCutoff(invoiceDate) < cutoffDayOfMonth) {
        return null;
    }
    const substituteDate = substituteAnchorInMonthAfter(
        invoiceDate,
        substituteDayOfMonth
    );
    return differenceInCalendarDays(substituteDate, invoiceDate);
}

/**
 * Month-end target date: when invoice issue day-of-month is on or after cutoff,
 * return `due_date + offset_days + diff` where diff is calendar days from
 * `invoice_date` to the substitute day in the month after the invoice month;
 * otherwise `due_date + offset_days`.
 */
export function applyMonthEndCutoffAdjustment(args: {
    dueDate: Date | null | undefined;
    offsetDays: number | null | undefined;
    invoiceDate: Date | null | undefined;
    cutoffDayOfMonth: number | null | undefined;
    substituteDayOfMonth: number | null | undefined;
}): Date | null {
    const {
        dueDate,
        offsetDays,
        invoiceDate,
        cutoffDayOfMonth,
        substituteDayOfMonth,
    } = args;
    if (!dueDate || offsetDays === null || offsetDays === undefined) {
        return null;
    }
    if (
        cutoffDayOfMonth == null ||
        substituteDayOfMonth == null ||
        invoiceDate == null
    ) {
        return addCalendarDaysToDate(dueDate, offsetDays);
    }
    if (calendarDayOfMonthForCutoff(invoiceDate) < cutoffDayOfMonth) {
        return addCalendarDaysToDate(dueDate, offsetDays);
    }
    const substituteDate = substituteAnchorInMonthAfter(
        invoiceDate,
        substituteDayOfMonth
    );
    const diff = differenceInCalendarDays(substituteDate, invoiceDate);
    return addCalendarDaysToDate(dueDate, offsetDays + diff);
}

export function computeTargetReportingDate(
    dueDate: Date | null | undefined,
    reportingDays: number | null | undefined,
    monthEnd?: MonthEndCutoffOptions
): Date | null {
    if (!monthEnd) {
        return addCalendarDaysToDate(dueDate, reportingDays ?? null);
    }
    return applyMonthEndCutoffAdjustment({
        dueDate,
        offsetDays: reportingDays ?? null,
        invoiceDate: monthEnd.invoiceDate,
        cutoffDayOfMonth: monthEnd.cutoffDayOfMonth,
        substituteDayOfMonth: monthEnd.substituteDayOfMonth,
    });
}

/**
 * Target MEP date: `due_date + max_allowed_mep` (calendar days), or when
 * month-end cutoff applies, `due_date + max_allowed_mep + diff`.
 */
export function computeTargetMepDate(
    dueDate: Date | null | undefined,
    maxAllowedMep: number | null | undefined,
    monthEnd?: MonthEndCutoffOptions
): Date | null {
    if (!monthEnd) {
        return addCalendarDaysToDate(dueDate, maxAllowedMep ?? null);
    }
    return applyMonthEndCutoffAdjustment({
        dueDate,
        offsetDays: maxAllowedMep ?? null,
        invoiceDate: monthEnd.invoiceDate,
        cutoffDayOfMonth: monthEnd.cutoffDayOfMonth,
        substituteDayOfMonth: monthEnd.substituteDayOfMonth,
    });
}

/**
 * Credit days = calendar days from invoice_date to due_date (same as {@link computePaymentTermDays}).
 * `ctv_payment_term` is true when `credit_days > max_payment_term` (i.e. max_payment_term − credit_days < 0).
 * When payment-term month-end cutoff applies (on/after cutoff), compares against
 * `max_payment_term + diff` instead. If `max_payment_term` or credit days cannot be derived, returns false.
 */
export function computePaymentTermBreach(
    invoiceDate: Date | null | undefined,
    dueDate: Date | null | undefined,
    maxPaymentTerm: number | null | undefined,
    monthEnd?: MonthEndCutoffOptions
): boolean {
    const creditDays = computePaymentTermDays(invoiceDate, dueDate);
    if (
        creditDays === null ||
        maxPaymentTerm === null ||
        maxPaymentTerm === undefined
    ) {
        return false;
    }
    const diff = computeMonthEndCutoffDiffIfApplicable({
        invoiceDate: monthEnd?.invoiceDate ?? invoiceDate,
        cutoffDayOfMonth: monthEnd?.cutoffDayOfMonth,
        substituteDayOfMonth: monthEnd?.substituteDayOfMonth,
    });
    const effectiveCap =
        diff !== null ? maxPaymentTerm + diff : maxPaymentTerm;
    return creditDays > effectiveCap;
}

export function startOfUtcDay(d: Date): Date {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
}

/**
 * Normalize a Date to a local calendar midnight for comparisons between:
 * - `@db.Date` fields from PostgreSQL (Prisma uses UTC midnight for the stored day), and
 * - dates from {@link parseImportDateToLocalCalendarDate} (local calendar day).
 */
function normalizeCalendarDayForInsuranceCompare(d: Date): Date {
    const utcMidnight =
        d.getUTCHours() === 0 &&
        d.getUTCMinutes() === 0 &&
        d.getUTCSeconds() === 0 &&
        d.getUTCMilliseconds() === 0;
    if (utcMidnight) {
        return new Date(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate()
        );
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * True when the target reporting calendar day is strictly before today
 * (reporting date &lt; today).
 */
export function isTargetReportingDateBeforeToday(
    targetReportingDate: Date,
    today: Date = new Date()
): boolean {
    const todayNorm = normalizeCalendarDayForInsuranceCompare(today);
    const targetNorm =
        normalizeCalendarDayForInsuranceCompare(targetReportingDate);
    return differenceInCalendarDays(todayNorm, targetNorm) > 0;
}

/**
 * Whether reporting_breach should be true for an open Due/Overdue invoice
 * (evaluation only; persistence in sync helper).
 */
export function shouldSetReportingBreach(
    status: invoice_status,
    targetReportingDate: Date | null | undefined,
    actualReportingDate: Date | null | undefined,
    today: Date = new Date()
): boolean {
    if (status !== "Due" && status !== "Overdue") {
        return false;
    }
    if (!targetReportingDate || actualReportingDate) {
        return false;
    }
    return isTargetReportingDateBeforeToday(targetReportingDate, today);
}

export function computeCustomerTotalAr(customer: {
    total_due_amount?: number | null;
    total_overdue_amount?: number | null;
}): Prisma.Decimal {
    const due = new Prisma.Decimal(customer.total_due_amount ?? 0);
    const overdue = new Prisma.Decimal(customer.total_overdue_amount ?? 0);
    return due.plus(overdue);
}

/** Stored uninsured on active CustomerPolicy (display clamps ≥ 0 at API). */
export function computeUninsuredAmount(
    customer: {
        approved_limit?: unknown;
        uninsured_amount?: number | null;
    }
): Prisma.Decimal | null {
    const display = readUninsuredAmountForDisplay(customer);
    if (display == null) {
        return null;
    }
    return new Prisma.Decimal(display);
}

export type InsuranceComputedForRow = {
    payment_term: number | null;
    target_reporting_date: Date | null;
    target_mep_date: Date | null;
    reporting_breach: boolean;
    ctv_payment_term: boolean;
};

/** Snapshot flags for “created in terms violation” (set at import / refresh). */
export type CreatedTermsViolationSnapshot = {
    ctv_customer_overdue_mep: boolean;
    ctv_customer_excluded_from_policy: boolean;
    ctv_outdated_dcl: boolean;
    ctv_invoice_after_policy_end: boolean;
};

/**
 * Snapshot at import: mirrors Customer.overdue_block (true ⇒ ctv_customer_overdue_mep).
 */
export function computeCreatedTermsViolationCustomerOverdueMep(
    customerOverdueBlock: boolean | null | undefined
): boolean {
    return customerOverdueBlock === true;
}

/**
 * Customer **MEP** (deadline date) = `oldest_invoice_overdue_date + max_allowed_mep` calendar days.
 * **overdue_block** = business rule “past Customer MEP”: `today` is strictly after that deadline
 * (same as calendar days from oldest overdue due to today exceeding `max_allowed_mep`).
 *
 * Note: The natural-language rule “oldest_invoice_overdue_date > Customer MEP” would be impossible
 * if Customer MEP were that same deadline (oldest is never after oldest+MEP). The implemented rule is
 * **today > Customer MEP (deadline)**.
 */
export function computeCustomerOverdueBlock(args: {
    oldestInvoiceOverdueDate: Date | null | undefined;
    maxAllowedMepDays: number | null | undefined;
    today?: Date;
}): boolean {
    const { oldestInvoiceOverdueDate, maxAllowedMepDays } = args;
    const today = args.today ?? new Date();
    if (
        !oldestInvoiceOverdueDate ||
        maxAllowedMepDays === null ||
        maxAllowedMepDays === undefined
    ) {
        return false;
    }
    const customerMepDeadline = addDays(oldestInvoiceOverdueDate, maxAllowedMepDays);
    return differenceInCalendarDays(today, customerMepDeadline) > 0;
}

export function computeCreatedTermsViolationCustomerExcludedFromPolicy(
    exclusionReason: string | null | undefined
): boolean {
    return isCustomerPolicyExcluded(exclusionReason);
}

/**
 * Score-validity-only check for DCL (legacy 3-arg API). Prefer
 * {@link computeCreatedTermsViolationSnapshot} for full merged rules.
 */
export function computeCreatedTermsViolationOutdatedDcl(
    invoiceDate: Date,
    creditScoreInputDate: Date | null | undefined,
    scoreValidityPeriodMonths: number | null | undefined
): boolean {
    return computeOutdatedDclAtEvaluation({
        limitType: "DCL",
        evaluationDate: invoiceDate,
        creditScore: null,
        minCreditScore: null,
        creditScoreInputDate,
        scoreValidityPeriodMonths,
        activeCustomerSince: null,
        dclCustomerSinceMonths: null,
    });
}

/** Invoice issue date on or after policy end — expiry day counts as violation (calendar days). */
export function computeCreatedTermsViolationInvoiceAfterPolicyEnd(
    invoiceDate: Date,
    policyEndDate: Date | null | undefined
): boolean {
    if (!policyEndDate) {
        return false;
    }
    const inv = normalizeCalendarDayForInsuranceCompare(invoiceDate);
    const pol = normalizeCalendarDayForInsuranceCompare(policyEndDate);
    return differenceInCalendarDays(inv, pol) >= 0;
}

export function computeCreatedTermsViolationSnapshot(args: {
    invoice_date: Date;
    customer: {
        overdue_block?: boolean | null;
        policy_exclusion_reason?: string | null;
        credit_score_input_date?: Date | null;
        policy_id?: number | null;
        limit_type?: string | null;
        credit_score?: unknown;
        active_customer_since?: Date | null;
    };
    policy: {
        end_date: Date;
        score_validity_period_months: number | null;
        min_credit_score?: unknown;
        dcl_customer_since_months?: number | null;
    } | null;
}): CreatedTermsViolationSnapshot {
    const ctv_customer_overdue_mep =
        computeCreatedTermsViolationCustomerOverdueMep(args.customer.overdue_block);
    const ctv_customer_excluded_from_policy =
        computeCreatedTermsViolationCustomerExcludedFromPolicy(
            args.customer.policy_exclusion_reason
        );
    const ctv_outdated_dcl = computeOutdatedDclAtEvaluation({
        limitType: args.customer.limit_type ?? null,
        evaluationDate: args.invoice_date,
        creditScore: args.customer.credit_score ?? null,
        minCreditScore: args.policy?.min_credit_score ?? null,
        creditScoreInputDate: args.customer.credit_score_input_date,
        scoreValidityPeriodMonths:
            args.policy?.score_validity_period_months ?? null,
        activeCustomerSince: args.customer.active_customer_since ?? null,
        dclCustomerSinceMonths:
            args.policy?.dcl_customer_since_months ?? null,
    });
    const ctv_invoice_after_policy_end =
        computeCreatedTermsViolationInvoiceAfterPolicyEnd(
            args.invoice_date,
            args.policy?.end_date ?? null
        );

    return {
        ctv_customer_overdue_mep,
        ctv_customer_excluded_from_policy,
        ctv_outdated_dcl,
        ctv_invoice_after_policy_end,
    };
}

/**
 * Compute persisted insurance-related invoice fields from customer + dates + status.
 *
 * - `target_reporting_date` = due_date + `customer.reporting_days` (calendar days),
 *   or due_date + reporting_days + diff when invoice month-end cutoff applies
 * - `target_mep_date` = due_date + `customer.max_allowed_mep` (calendar days),
 *   or due_date + max_allowed_mep + diff when invoice month-end cutoff applies
 * - `ctv_payment_term` = credit days (due − issue) > `customer.max_payment_term`
 *   (or > max_payment_term + diff when payment-term month-end cutoff applies)
 */
export function computeInvoiceInsuranceRowData(args: {
    status: invoice_status;
    invoice_date: Date | null | undefined;
    due_date: Date | null | undefined;
    actual_reporting_date?: Date | null | undefined;
    customer: {
        reporting_days: number | null;
        max_allowed_mep: number | null;
        max_payment_term: number | null;
        mep_cutoff_day_of_month?: number | null;
        mep_substitute_day_of_month?: number | null;
        reporting_cutoff_day_of_month?: number | null;
        reporting_substitute_day_of_month?: number | null;
        payment_term_cutoff_day_of_month?: number | null;
        payment_term_substitute_day_of_month?: number | null;
    };
    /** When true, use explicit payment_term from input instead of calendar diff */
    explicitPaymentTerm?: number | null;
    today?: Date;
}): InsuranceComputedForRow {
    const today = args.today ?? new Date();
    const payment_term =
        args.explicitPaymentTerm !== undefined && args.explicitPaymentTerm !== null
            ? args.explicitPaymentTerm
            : computePaymentTermDays(args.invoice_date, args.due_date);

    const target_reporting_date = computeTargetReportingDate(
        args.due_date,
        args.customer.reporting_days,
        {
            invoiceDate: args.invoice_date,
            cutoffDayOfMonth: args.customer.reporting_cutoff_day_of_month,
            substituteDayOfMonth: args.customer.reporting_substitute_day_of_month,
        }
    );
    const target_mep_date = computeTargetMepDate(
        args.due_date,
        args.customer.max_allowed_mep,
        {
            invoiceDate: args.invoice_date,
            cutoffDayOfMonth: args.customer.mep_cutoff_day_of_month,
            substituteDayOfMonth: args.customer.mep_substitute_day_of_month,
        }
    );

    const reporting_breach = shouldSetReportingBreach(
        args.status,
        target_reporting_date,
        args.actual_reporting_date ?? null,
        today
    );

    const ctv_payment_term = computePaymentTermBreach(
        args.invoice_date,
        args.due_date,
        args.customer.max_payment_term,
        {
            invoiceDate: args.invoice_date,
            cutoffDayOfMonth: args.customer.payment_term_cutoff_day_of_month,
            substituteDayOfMonth:
                args.customer.payment_term_substitute_day_of_month,
        }
    );

    return {
        payment_term,
        target_reporting_date,
        target_mep_date,
        reporting_breach,
        ctv_payment_term,
    };
}

/**
 * Open AR above approved limit (0 if within limit or no limit).
 * Matches per-customer capacity gap used on the credit insurance dashboard.
 */
export function computeCustomerCapacityGapAmount(customer: {
    outdated_dcl?: boolean | null;
    total_due_amount?: number | null;
    total_overdue_amount?: number | null;
    approved_limit?: unknown;
}): number {
    if (customer.outdated_dcl === true) {
        return 0;
    }
    const lim = customer.approved_limit;
    if (lim === null || lim === undefined) {
        return 0;
    }
    const ar = computeCustomerTotalAr(customer);
    if (ar.lte(0)) {
        return 0;
    }
    const limitDec = new Prisma.Decimal(lim as string | number);
    const diff = ar.sub(limitDec);
    if (diff.lte(0)) {
        return 0;
    }
    return diff.toNumber();
}

/**
 * Capacity gap for UI in account currency from stored CustomerPolicy fields.
 * {@link accountCurrency} is unused; kept for call-site compatibility.
 */
export function computeCustomerCapacityGapAmountForAccountDisplay(
    customer: {
        outdated_dcl?: boolean | null;
        approved_limit?: unknown;
        capacity_gap_amount?: number | null;
    },
    _accountCurrency?: string | null | undefined
): number {
    return storedCapacityGapAmount(customer);
}

/**
 * Allocated at-risk for a customer **with** a linked policy:
 * min(open AR, capacity gap + terms-breach outstanding).
 *
 * Terms-breach outstanding passed in must **exclude** invoices already in the
 * capacity gap (`excludeCapacityGapInvoices` on breach queries) so one invoice
 * is not counted twice.
 */
export function computeCustomerRiskExposure(args: {
    totalAr: number;
    capacityGapAmount: number;
    termsBreachOutstanding: number;
}): number {
    const ar = Math.max(0, args.totalAr);
    if (ar <= 0) {
        return 0;
    }
    const termsBreach = Math.max(0, args.termsBreachOutstanding);
    const gap = Math.max(0, args.capacityGapAmount);
    return Math.min(ar, gap + termsBreach);
}

/** Open AR minus effective approved limit (0 when within effective cover). */
export function computeLimitExcessOverEffective(
    totalAr: number,
    effectiveApprovedLimit: number | null | undefined
): number {
    const ar = Math.max(0, totalAr);
    const effective = Math.max(0, Number(effectiveApprovedLimit ?? 0));
    if (effective <= 0) {
        return 0;
    }
    return Math.max(0, ar - effective);
}

export type NearLimitUtilizationWarningInput = {
    ar: number;
    approvedLimit: number | null | undefined;
    /** When top-up is enabled, compare against effective (approved + top-up) limit in account currency. */
    effectiveLimitInAccountCurrency?: number | null;
    useEffectiveLimit?: boolean;
    thresholdPct: number;
    /** DCL score/limit invalid — skip "over limit" exclusion (still capped at 100% of comparison limit). */
    outdatedDcl?: boolean | null;
};

/**
 * True when open AR is at or above the warning threshold % of the comparison limit
 * but not above 100% of that limit (over-limit moves to capacity gap).
 */
export function isNearLimitUtilizationWarning(
    input: NearLimitUtilizationWarningInput
): boolean {
    const ar = Math.max(0, input.ar);
    if (ar <= 0) {
        return false;
    }
    const approved = Number(input.approvedLimit ?? 0);
    if (input.approvedLimit == null || approved <= 0) {
        return false;
    }
    const useEffective =
        input.useEffectiveLimit === true &&
        input.effectiveLimitInAccountCurrency != null &&
        input.effectiveLimitInAccountCurrency > 0;
    const limitForCheck = useEffective
        ? input.effectiveLimitInAccountCurrency!
        : approved;
    if (limitForCheck <= 0) {
        return false;
    }
    if (input.outdatedDcl !== true && ar > limitForCheck) {
        return false;
    }
    const t = Math.min(100, Math.max(1, input.thresholdPct));
    const atThreshold = limitForCheck * (t / 100);
    return ar >= atThreshold && ar <= limitForCheck;
}

/**
 * Invoice-level capacity gap contribution.
 *
 * Rules:
 * - Snapshot basis (`limit_assessed_amount`) is captured once when invoice becomes open.
 * - Contribution is `max(0, outstanding_left - limit_assessed_amount)`.
 * - "New exposure" invoices are represented by zero assessed basis, so contribution equals outstanding.
 */
export function computeInvoiceCapacityGapContribution(args: {
    outstandingLeft: number | null | undefined;
    limitAssessedAmount: number | null | undefined;
}): number {
    const outstanding = Math.max(0, Number(args.outstandingLeft ?? 0));
    if (!Number.isFinite(outstanding) || outstanding <= 0) {
        return 0;
    }
    const assessed = Math.max(0, Number(args.limitAssessedAmount ?? 0));
    if (!Number.isFinite(assessed)) {
        return 0;
    }
    return Math.max(0, outstanding - assessed);
}

/**
 * Open-AR line amount in policy/invoice currency for capacity gap computation.
 *
 * Prefers `customer_outstanding_debt` (invoice currency = policy currency) over
 * `outstanding_debt` (account base currency), because `limit_assessed_amount` is
 * stored in policy currency. Using account-currency outstanding against a
 * policy-currency limit produces wrong gaps when currencies differ.
 */
export function invoiceOutstandingLeft(row: {
    outstanding_debt: number | null | undefined;
    customer_outstanding_debt: number | null | undefined;
    amount: number | null | undefined;
}): number {
    // Prefer customer_outstanding_debt (invoice/policy currency) — matches limit_assessed_amount currency
    if (
        row.customer_outstanding_debt != null &&
        row.customer_outstanding_debt !== 0
    ) {
        return Number(row.customer_outstanding_debt);
    }
    if (row.outstanding_debt != null && row.outstanding_debt !== 0) {
        return Number(row.outstanding_debt);
    }
    return Number(row.amount ?? 0);
}

/**
 * Outstanding left in limit-assessed currency for capacity gap.
 * When limit currency equals account currency, use account-currency outstanding
 * (`outstanding_debt`) — avoids mixing ILS customer lines with GBP limits.
 */
export function invoiceOutstandingInLimitCurrency(row: {
    outstanding_debt: number | null | undefined;
    customer_outstanding_debt: number | null | undefined;
    amount: number | null | undefined;
    customer_currency?: string | null | undefined;
    limit_assessed_currency?: string | null | undefined;
    accountCurrency?: string | null | undefined;
}): number {
    const limitCcy = row.limit_assessed_currency?.trim().toUpperCase() ?? null;
    const acct = row.accountCurrency?.trim().toUpperCase() ?? null;
    const customerCcy = row.customer_currency?.trim().toUpperCase() ?? null;

    if (limitCcy && acct && limitCcy === acct) {
        return invoiceOutstandingInAccountCurrency(row);
    }
    if (
        limitCcy &&
        customerCcy &&
        limitCcy !== customerCcy &&
        row.outstanding_debt != null &&
        row.outstanding_debt !== 0
    ) {
        // Stamp in limit/policy currency: when invoice currency differs, base outstanding
        // is the safest source if accountCurrency is unavailable at call-site.
        return Number(row.outstanding_debt);
    }

    return invoiceOutstandingLeft(row);
}

/**
 * Open-AR line amount in account base currency (for account-currency totals).
 * Prefers `outstanding_debt` (account currency) over `customer_outstanding_debt`.
 */
export function invoiceOutstandingInAccountCurrency(row: {
    outstanding_debt: number | null | undefined;
    customer_outstanding_debt: number | null | undefined;
    amount: number | null | undefined;
}): number {
    if (row.outstanding_debt != null && row.outstanding_debt !== 0) {
        return Number(row.outstanding_debt);
    }
    if (
        row.customer_outstanding_debt != null &&
        row.customer_outstanding_debt !== 0
    ) {
        return Number(row.customer_outstanding_debt);
    }
    return Number(row.amount ?? 0);
}

/**
 * Snapshot basis stamped when an invoice becomes open: consumes approved headroom
 * first, then top-up pool (waterfall). When {@link newInvoiceOutstanding} is set,
 * returns the limit actually allocated to this invoice (not merely pool headroom).
 */
export function computeLimitAssessedAmountForNewOpenInvoice(args: {
    approvedLimit: number | null | undefined;
    topUpTotal?: number | null | undefined;
    openArOnPolicyBeforeInvoice: number;
    /** Open outstanding on this invoice in limit/policy currency. */
    newInvoiceOutstanding?: number | null;
}): number {
    const approved =
        args.approvedLimit == null ? null : Number(args.approvedLimit);
    const openBefore = Math.max(
        0,
        Number(args.openArOnPolicyBeforeInvoice ?? 0)
    );
    const topUp = Math.max(0, Number(args.topUpTotal ?? 0));
    if (approved == null || !Number.isFinite(approved) || approved <= 0) {
        return 0;
    }

    const approvedHeadroom = Math.max(0, approved - openBefore);
    const topUpHeadroom =
        openBefore < approved
            ? topUp
            : Math.max(0, topUp - (openBefore - approved));

    const newOutstanding = args.newInvoiceOutstanding;
    if (
        newOutstanding == null ||
        !Number.isFinite(Number(newOutstanding))
    ) {
        if (openBefore < approved) {
            return approvedHeadroom;
        }
        return topUpHeadroom;
    }

    const outstanding = Math.max(0, Number(newOutstanding));
    const fromApproved = Math.min(outstanding, approvedHeadroom);
    const fromTopUp = Math.min(outstanding - fromApproved, topUpHeadroom);
    return fromApproved + fromTopUp;
}

export type InvoiceForCapacityGapSum = {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    amount: number | null;
    limit_assessed_amount: number | null;
    capacity_gap_amount?: number | null;
    capacity_gap_amount_limit?: number | null;
};

/** Sum per-invoice gap; prefers stored fields, falls back to runtime compute. */
export function sumInvoiceCapacityGapContributions(
    invoices: InvoiceForCapacityGapSum[]
): { total: number | null; hasMissingSnapshots: boolean } {
    if (invoices.length === 0) {
        return { total: 0, hasMissingSnapshots: false };
    }
    const hasMissingSnapshots = invoices.some(
        (inv) => inv.limit_assessed_amount == null
    );
    if (hasMissingSnapshots) {
        return { total: null, hasMissingSnapshots: true };
    }

    const hasStoredGaps = invoices.some(
        (inv) =>
            inv.capacity_gap_amount_limit != null ||
            inv.capacity_gap_amount != null
    );

    const total = invoices.reduce((sum, inv) => {
        if (hasStoredGaps && inv.capacity_gap_amount_limit != null) {
            return sum + Math.max(0, Number(inv.capacity_gap_amount_limit));
        }
        return (
            sum +
            computeInvoiceCapacityGapContribution({
                outstandingLeft: invoiceOutstandingLeft(inv),
                limitAssessedAmount: Number(inv.limit_assessed_amount ?? 0),
            })
        );
    }, 0);
    return { total, hasMissingSnapshots: false };
}
