import { Prisma, type invoice_status } from "@prisma/client";
/**
 * Parse import/API date values as a local calendar day (avoids UTC off-by-one on YYYY-MM-DD).
 * Used for invoice import and insurance date math.
 */
export declare function parseImportDateToLocalCalendarDate(value: unknown): Date | null;
/**
 * Calendar-day credit term: days from invoice_date to due_date.
 */
export declare function computePaymentTermDays(invoiceDate: Date | null | undefined, dueDate: Date | null | undefined): number | null;
export declare function addCalendarDaysToDate(base: Date | null | undefined, days: number | null | undefined): Date | null;
export type MonthEndCutoffOptions = {
    invoiceDate?: Date | null | undefined;
    cutoffDayOfMonth?: number | null | undefined;
    substituteDayOfMonth?: number | null | undefined;
};
/**
 * Calendar days from `invoice_date` to the substitute day in the month after the
 * invoice month when issue day-of-month is on or after cutoff; otherwise null.
 */
export declare function computeMonthEndCutoffDiffIfApplicable(args: {
    invoiceDate: Date | null | undefined;
    cutoffDayOfMonth: number | null | undefined;
    substituteDayOfMonth: number | null | undefined;
}): number | null;
/**
 * Month-end target date: when invoice issue day-of-month is on or after cutoff,
 * return `due_date + offset_days + diff` where diff is calendar days from
 * `invoice_date` to the substitute day in the month after the invoice month;
 * otherwise `due_date + offset_days`.
 */
export declare function applyMonthEndCutoffAdjustment(args: {
    dueDate: Date | null | undefined;
    offsetDays: number | null | undefined;
    invoiceDate: Date | null | undefined;
    cutoffDayOfMonth: number | null | undefined;
    substituteDayOfMonth: number | null | undefined;
}): Date | null;
export declare function computeTargetReportingDate(dueDate: Date | null | undefined, reportingDays: number | null | undefined, monthEnd?: MonthEndCutoffOptions): Date | null;
/**
 * Target MEP date: `due_date + max_allowed_mep` (calendar days), or when
 * month-end cutoff applies, `due_date + max_allowed_mep + diff`.
 */
export declare function computeTargetMepDate(dueDate: Date | null | undefined, maxAllowedMep: number | null | undefined, monthEnd?: MonthEndCutoffOptions): Date | null;
/**
 * Credit days = calendar days from invoice_date to due_date (same as {@link computePaymentTermDays}).
 * `ctv_payment_term` is true when `credit_days > max_payment_term` (i.e. max_payment_term − credit_days < 0).
 * When payment-term month-end cutoff applies (on/after cutoff), compares against
 * `max_payment_term + diff` instead. If `max_payment_term` or credit days cannot be derived, returns false.
 */
export declare function computePaymentTermBreach(invoiceDate: Date | null | undefined, dueDate: Date | null | undefined, maxPaymentTerm: number | null | undefined, monthEnd?: MonthEndCutoffOptions): boolean;
export declare function startOfUtcDay(d: Date): Date;
/**
 * True when the target reporting calendar day is strictly before today
 * (reporting date &lt; today).
 */
export declare function isTargetReportingDateBeforeToday(targetReportingDate: Date, today?: Date): boolean;
/**
 * Whether reporting_breach should be true for an open Due/Overdue invoice
 * (evaluation only; persistence in sync helper).
 */
export declare function shouldSetReportingBreach(status: invoice_status, targetReportingDate: Date | null | undefined, actualReportingDate: Date | null | undefined, today?: Date): boolean;
export declare function computeCustomerTotalAr(customer: {
    total_due_amount?: number | null;
    total_overdue_amount?: number | null;
}): Prisma.Decimal;
/** Stored uninsured on active CustomerPolicy (display clamps ≥ 0 at API). */
export declare function computeUninsuredAmount(customer: {
    approved_limit?: unknown;
    uninsured_amount?: number | null;
}): Prisma.Decimal | null;
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
export declare function computeCreatedTermsViolationCustomerOverdueMep(customerOverdueBlock: boolean | null | undefined): boolean;
/**
 * Customer **MEP** (deadline date) = `oldest_invoice_overdue_date + max_allowed_mep` calendar days.
 * **overdue_block** = business rule “past Customer MEP”: `today` is strictly after that deadline
 * (same as calendar days from oldest overdue due to today exceeding `max_allowed_mep`).
 *
 * Note: The natural-language rule “oldest_invoice_overdue_date > Customer MEP” would be impossible
 * if Customer MEP were that same deadline (oldest is never after oldest+MEP). The implemented rule is
 * **today > Customer MEP (deadline)**.
 */
export declare function computeCustomerOverdueBlock(args: {
    oldestInvoiceOverdueDate: Date | null | undefined;
    maxAllowedMepDays: number | null | undefined;
    today?: Date;
}): boolean;
export declare function computeCreatedTermsViolationCustomerExcludedFromPolicy(exclusionReason: string | null | undefined): boolean;
/**
 * Score-validity-only check for DCL (legacy 3-arg API). Prefer
 * {@link computeCreatedTermsViolationSnapshot} for full merged rules.
 */
export declare function computeCreatedTermsViolationOutdatedDcl(invoiceDate: Date, creditScoreInputDate: Date | null | undefined, scoreValidityPeriodMonths: number | null | undefined): boolean;
/** Invoice issue date on or after policy end — expiry day counts as violation (calendar days). */
export declare function computeCreatedTermsViolationInvoiceAfterPolicyEnd(invoiceDate: Date, policyEndDate: Date | null | undefined): boolean;
export declare function computeCreatedTermsViolationSnapshot(args: {
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
}): CreatedTermsViolationSnapshot;
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
export declare function computeInvoiceInsuranceRowData(args: {
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
}): InsuranceComputedForRow;
/**
 * Open AR above approved limit (0 if within limit or no limit).
 * Matches per-customer capacity gap used on the credit insurance dashboard.
 */
export declare function computeCustomerCapacityGapAmount(customer: {
    outdated_dcl?: boolean | null;
    total_due_amount?: number | null;
    total_overdue_amount?: number | null;
    approved_limit?: unknown;
}): number;
/**
 * Capacity gap for UI in account currency from stored CustomerPolicy fields.
 * {@link accountCurrency} is unused; kept for call-site compatibility.
 */
export declare function computeCustomerCapacityGapAmountForAccountDisplay(customer: {
    outdated_dcl?: boolean | null;
    approved_limit?: unknown;
    capacity_gap_amount?: number | null;
}, _accountCurrency?: string | null | undefined): number;
/**
 * Allocated at-risk for a customer **with** a linked policy:
 * min(open AR, capacity gap + terms-breach outstanding).
 *
 * Terms-breach outstanding must be **net of invoice capacity gap** so the same
 * money is not added twice. `min(AR, …)` still caps when the remaining sum
 * exceeds open AR.
 */
export declare function computeCustomerRiskExposure(args: {
    totalAr: number;
    capacityGapAmount: number;
    termsBreachOutstanding: number;
}): number;
/** Open AR minus effective approved limit (0 when within effective cover). */
export declare function computeLimitExcessOverEffective(totalAr: number, effectiveApprovedLimit: number | null | undefined): number;
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
export declare function isNearLimitUtilizationWarning(input: NearLimitUtilizationWarningInput): boolean;
/**
 * Invoice-level capacity gap contribution.
 *
 * Rules:
 * - Snapshot basis (`limit_assessed_amount`) is captured once when invoice becomes open.
 * - Contribution is `max(0, outstanding_left - limit_assessed_amount)`.
 * - "New exposure" invoices are represented by zero assessed basis, so contribution equals outstanding.
 */
export declare function computeInvoiceCapacityGapContribution(args: {
    outstandingLeft: number | null | undefined;
    limitAssessedAmount: number | null | undefined;
}): number;
/**
 * Open-AR line amount in policy/invoice currency for capacity gap computation.
 *
 * Prefers `customer_outstanding_debt` (invoice currency = policy currency) over
 * `outstanding_debt` (account base currency), because `limit_assessed_amount` is
 * stored in policy currency. Using account-currency outstanding against a
 * policy-currency limit produces wrong gaps when currencies differ.
 */
export declare function invoiceOutstandingLeft(row: {
    outstanding_debt: number | null | undefined;
    customer_outstanding_debt: number | null | undefined;
    amount: number | null | undefined;
}): number;
/**
 * Outstanding left in limit-assessed currency for capacity gap.
 * When limit currency equals account currency, use account-currency outstanding
 * (`outstanding_debt`) — avoids mixing ILS customer lines with GBP limits.
 */
export declare function invoiceOutstandingInLimitCurrency(row: {
    outstanding_debt: number | null | undefined;
    customer_outstanding_debt: number | null | undefined;
    amount: number | null | undefined;
    customer_currency?: string | null | undefined;
    limit_assessed_currency?: string | null | undefined;
    accountCurrency?: string | null | undefined;
}): number;
/**
 * Open-AR line amount in account base currency (for account-currency totals).
 * Prefers `outstanding_debt` (account currency) over `customer_outstanding_debt`.
 */
export declare function invoiceOutstandingInAccountCurrency(row: {
    outstanding_debt: number | null | undefined;
    customer_outstanding_debt: number | null | undefined;
    amount: number | null | undefined;
}): number;
/**
 * Snapshot basis stamped when an invoice becomes open: consumes approved headroom
 * first, then top-up pool (waterfall). When {@link newInvoiceOutstanding} is set,
 * returns the limit actually allocated to this invoice (not merely pool headroom).
 */
export declare function computeLimitAssessedAmountForNewOpenInvoice(args: {
    approvedLimit: number | null | undefined;
    topUpTotal?: number | null | undefined;
    openArOnPolicyBeforeInvoice: number;
    /** Open outstanding on this invoice in limit/policy currency. */
    newInvoiceOutstanding?: number | null;
}): number;
export type InvoiceForCapacityGapSum = {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    amount: number | null;
    limit_assessed_amount: number | null;
    capacity_gap_amount?: number | null;
    capacity_gap_amount_limit?: number | null;
};
/** Sum per-invoice gap; prefers stored fields, falls back to runtime compute. */
export declare function sumInvoiceCapacityGapContributions(invoices: InvoiceForCapacityGapSum[]): {
    total: number | null;
    hasMissingSnapshots: boolean;
};
