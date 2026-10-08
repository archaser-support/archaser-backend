import {
    getCustomerPolicyRow,
    mergeActiveCustomerPolicySelect,
    normalizeCalendarDayForInsuranceCompare,
} from "@archaser/credit-insurance-domain";

/** Row key carrying per-breach tooltip inputs (customer invoice grid, Contains breaches column). */
export const INVOICE_VIOLATION_DETAILS_KEY =
    "__credit_insurance_violation_details";

/** Dates are calendar days (`YYYY-MM-DD`); missing inputs are null. */
export type InvoiceViolationDetails = {
    invoice_date: string | null;
    due_date: string | null;
    target_reporting_date: string | null;
    actual_reporting_date: string | null;
    /** Reported: actual − target; not reported: today − target. */
    reporting_days_late: number | null;
    /** due_date − invoice_date. */
    credit_days: number | null;
    max_payment_term: number | null;
    mep_cause_invoice_number: string | null;
    mep_cause_due_date: string | null;
    /** Cause open amount in customer currency on this invoice's issue date. */
    mep_cause_outstanding: number | null;
    mep_days_past: number | null;
    customer_currency: string | null;
    policy_exclusion_reason: string | null;
    credit_score_input_date: string | null;
    score_validity_period_months: number | null;
    policy_end_date: string | null;
};

const CUSTOMER_POLICY_DETAIL_FIELDS = [
    "max_payment_term",
    "policy_exclusion_reason",
    "credit_score_input_date",
    "InsurancePolicy.end_date",
    "InsurancePolicy.score_validity_period_months",
];

const MS_PER_DAY = 86_400_000;

function ensureRelationSelect(
    select: Record<string, unknown>,
    relation: string
): Record<string, unknown> {
    const existing = select[relation] as
        { select?: Record<string, unknown> } | undefined;
    if (existing?.select && typeof existing.select === "object") {
        return existing.select;
    }
    const nested: Record<string, unknown> = { id: true };
    select[relation] = {
        ...(existing && typeof existing === "object" ? existing : {}),
        select: nested,
    };
    return nested;
}

/** Invoice-primary select additions needed by {@link buildInvoiceViolationDetails}. */
export function mergeInvoiceViolationDetailsSelect(
    select: Record<string, unknown>
): void {
    select.invoice_date = true;
    select.due_date = true;
    select.target_reporting_date = true;
    select.actual_reporting_date = true;
    select.policy_id = true;
    select.ctv_customer_overdue_mep_cause_invoice_number = true;
    select.ctv_customer_overdue_mep_cause_due_date = true;
    select.ctv_customer_overdue_mep_cause_outstanding = true;
    select.ctv_customer_overdue_mep_days_past = true;
    select.customer_currency = true;

    const policySelect = ensureRelationSelect(select, "InsurancePolicy");
    policySelect.end_date = true;
    policySelect.score_validity_period_months = true;

    mergeActiveCustomerPolicySelect(
        ensureRelationSelect(select, "Customer"),
        CUSTOMER_POLICY_DETAIL_FIELDS
    );
}

function toCalendarDay(value: unknown): Date | null {
    if (value == null || value === "") {
        return null;
    }
    if (typeof value === "string") {
        const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
        if (ymd) {
            return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
        }
    }
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return normalizeCalendarDayForInsuranceCompare(date);
}

function toYmd(day: Date | null): string | null {
    if (!day) {
        return null;
    }
    const mm = String(day.getMonth() + 1).padStart(2, "0");
    const dd = String(day.getDate()).padStart(2, "0");
    return `${day.getFullYear()}-${mm}-${dd}`;
}

function diffCalendarDays(from: Date | null, to: Date | null): number | null {
    if (!from || !to) {
        return null;
    }
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function toFiniteNumber(value: unknown): number | null {
    if (value == null || value === "") {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toNonEmptyString(value: unknown): string | null {
    if (value == null) {
        return null;
    }
    const s = String(value).trim();
    return s === "" ? null : s;
}

/** Per-breach tooltip inputs from a raw Invoice row selected with {@link mergeInvoiceViolationDetailsSelect}. */
export function buildInvoiceViolationDetails(
    row: Record<string, unknown>,
    today: Date = new Date()
): InvoiceViolationDetails {
    const invoiceDate = toCalendarDay(row.invoice_date);
    const dueDate = toCalendarDay(row.due_date);
    const targetReportingDate = toCalendarDay(row.target_reporting_date);
    const actualReportingDate = toCalendarDay(row.actual_reporting_date);

    const customerPolicy = getCustomerPolicyRow(row.Customer, row);
    const invoicePolicy = row.InsurancePolicy as
        Record<string, unknown> | null | undefined;
    const customerInsurancePolicy = customerPolicy?.InsurancePolicy ?? null;

    const daysLate = diffCalendarDays(
        targetReportingDate,
        actualReportingDate ?? normalizeCalendarDayForInsuranceCompare(today)
    );

    return {
        invoice_date: toYmd(invoiceDate),
        due_date: toYmd(dueDate),
        target_reporting_date: toYmd(targetReportingDate),
        actual_reporting_date: toYmd(actualReportingDate),
        reporting_days_late:
            daysLate != null && daysLate >= 0 ? daysLate : null,
        credit_days: diffCalendarDays(invoiceDate, dueDate),
        max_payment_term: toFiniteNumber(customerPolicy?.max_payment_term),
        mep_cause_invoice_number: toNonEmptyString(
            row.ctv_customer_overdue_mep_cause_invoice_number
        ),
        mep_cause_due_date: toYmd(
            toCalendarDay(row.ctv_customer_overdue_mep_cause_due_date)
        ),
        mep_cause_outstanding: toFiniteNumber(
            row.ctv_customer_overdue_mep_cause_outstanding
        ),
        mep_days_past: toFiniteNumber(row.ctv_customer_overdue_mep_days_past),
        customer_currency: toNonEmptyString(row.customer_currency),
        policy_exclusion_reason: toNonEmptyString(
            customerPolicy?.policy_exclusion_reason
        ),
        credit_score_input_date: toYmd(
            toCalendarDay(customerPolicy?.credit_score_input_date)
        ),
        score_validity_period_months: toFiniteNumber(
            invoicePolicy?.score_validity_period_months ??
                customerInsurancePolicy?.score_validity_period_months
        ),
        policy_end_date: toYmd(
            toCalendarDay(
                invoicePolicy?.end_date ?? customerInsurancePolicy?.end_date
            )
        ),
    };
}
