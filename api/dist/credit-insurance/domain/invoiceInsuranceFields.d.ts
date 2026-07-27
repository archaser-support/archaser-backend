import { Prisma, type invoice_status } from "@prisma/client";
export declare function parseImportDateToLocalCalendarDate(value: unknown): Date | null;
export declare function computePaymentTermDays(invoiceDate: Date | null | undefined, dueDate: Date | null | undefined): number | null;
export declare function addCalendarDaysToDate(base: Date | null | undefined, days: number | null | undefined): Date | null;
export type MonthEndCutoffOptions = {
    invoiceDate?: Date | null | undefined;
    cutoffDayOfMonth?: number | null | undefined;
    substituteDayOfMonth?: number | null | undefined;
};
export declare function computeMonthEndCutoffDiffIfApplicable(args: {
    invoiceDate: Date | null | undefined;
    cutoffDayOfMonth: number | null | undefined;
    substituteDayOfMonth: number | null | undefined;
}): number | null;
export declare function applyMonthEndCutoffAdjustment(args: {
    dueDate: Date | null | undefined;
    offsetDays: number | null | undefined;
    invoiceDate: Date | null | undefined;
    cutoffDayOfMonth: number | null | undefined;
    substituteDayOfMonth: number | null | undefined;
}): Date | null;
export declare function computeTargetReportingDate(dueDate: Date | null | undefined, reportingDays: number | null | undefined, monthEnd?: MonthEndCutoffOptions): Date | null;
export declare function computeTargetMepDate(dueDate: Date | null | undefined, maxAllowedMep: number | null | undefined, monthEnd?: MonthEndCutoffOptions): Date | null;
export declare function computePaymentTermBreach(invoiceDate: Date | null | undefined, dueDate: Date | null | undefined, maxPaymentTerm: number | null | undefined, monthEnd?: MonthEndCutoffOptions): boolean;
export declare function startOfUtcDay(d: Date): Date;
export declare function isTargetReportingDateBeforeToday(targetReportingDate: Date, today?: Date): boolean;
export declare function shouldSetReportingBreach(status: invoice_status, targetReportingDate: Date | null | undefined, actualReportingDate: Date | null | undefined, today?: Date): boolean;
export declare function computeCustomerTotalAr(customer: {
    total_due_amount?: number | null;
    total_overdue_amount?: number | null;
}): Prisma.Decimal;
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
export type CreatedTermsViolationSnapshot = {
    ctv_customer_overdue_mep: boolean;
    ctv_customer_excluded_from_policy: boolean;
    ctv_outdated_dcl: boolean;
    ctv_invoice_after_policy_end: boolean;
};
export declare function computeCreatedTermsViolationCustomerOverdueMep(customerOverdueBlock: boolean | null | undefined): boolean;
export declare function computeCustomerOverdueBlock(args: {
    oldestInvoiceOverdueDate: Date | null | undefined;
    maxAllowedMepDays: number | null | undefined;
    today?: Date;
}): boolean;
export declare function computeCreatedTermsViolationCustomerExcludedFromPolicy(exclusionReason: string | null | undefined): boolean;
export declare function computeCreatedTermsViolationOutdatedDcl(invoiceDate: Date, creditScoreInputDate: Date | null | undefined, scoreValidityPeriodMonths: number | null | undefined): boolean;
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
    explicitPaymentTerm?: number | null;
    today?: Date;
}): InsuranceComputedForRow;
export declare function computeCustomerCapacityGapAmount(customer: {
    outdated_dcl?: boolean | null;
    total_due_amount?: number | null;
    total_overdue_amount?: number | null;
    approved_limit?: unknown;
}): number;
export declare function computeCustomerCapacityGapAmountForAccountDisplay(customer: {
    outdated_dcl?: boolean | null;
    approved_limit?: unknown;
    capacity_gap_amount?: number | null;
}, _accountCurrency?: string | null | undefined): number;
export declare function computeCustomerRiskExposure(args: {
    totalAr: number;
    capacityGapAmount: number;
    termsBreachOutstanding: number;
}): number;
export declare function computeLimitExcessOverEffective(totalAr: number, effectiveApprovedLimit: number | null | undefined): number;
export type NearLimitUtilizationWarningInput = {
    ar: number;
    approvedLimit: number | null | undefined;
    effectiveLimitInAccountCurrency?: number | null;
    useEffectiveLimit?: boolean;
    thresholdPct: number;
    outdatedDcl?: boolean | null;
};
export declare function isNearLimitUtilizationWarning(input: NearLimitUtilizationWarningInput): boolean;
export declare function computeInvoiceCapacityGapContribution(args: {
    outstandingLeft: number | null | undefined;
    limitAssessedAmount: number | null | undefined;
}): number;
export declare function invoiceOutstandingLeft(row: {
    outstanding_debt: number | null | undefined;
    customer_outstanding_debt: number | null | undefined;
    amount: number | null | undefined;
}): number;
export declare function invoiceOutstandingInLimitCurrency(row: {
    outstanding_debt: number | null | undefined;
    customer_outstanding_debt: number | null | undefined;
    amount: number | null | undefined;
    customer_currency?: string | null | undefined;
    limit_assessed_currency?: string | null | undefined;
    accountCurrency?: string | null | undefined;
}): number;
export declare function invoiceOutstandingInAccountCurrency(row: {
    outstanding_debt: number | null | undefined;
    customer_outstanding_debt: number | null | undefined;
    amount: number | null | undefined;
}): number;
export declare function computeLimitAssessedAmountForNewOpenInvoice(args: {
    approvedLimit: number | null | undefined;
    topUpTotal?: number | null | undefined;
    openArOnPolicyBeforeInvoice: number;
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
export declare function sumInvoiceCapacityGapContributions(invoices: InvoiceForCapacityGapSum[]): {
    total: number | null;
    hasMissingSnapshots: boolean;
};
