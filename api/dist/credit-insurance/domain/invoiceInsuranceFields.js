"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseImportDateToLocalCalendarDate = parseImportDateToLocalCalendarDate;
exports.computePaymentTermDays = computePaymentTermDays;
exports.addCalendarDaysToDate = addCalendarDaysToDate;
exports.computeMonthEndCutoffDiffIfApplicable = computeMonthEndCutoffDiffIfApplicable;
exports.applyMonthEndCutoffAdjustment = applyMonthEndCutoffAdjustment;
exports.computeTargetReportingDate = computeTargetReportingDate;
exports.computeTargetMepDate = computeTargetMepDate;
exports.computePaymentTermBreach = computePaymentTermBreach;
exports.startOfUtcDay = startOfUtcDay;
exports.isTargetReportingDateBeforeToday = isTargetReportingDateBeforeToday;
exports.shouldSetReportingBreach = shouldSetReportingBreach;
exports.computeCustomerTotalAr = computeCustomerTotalAr;
exports.computeUninsuredAmount = computeUninsuredAmount;
exports.computeCreatedTermsViolationCustomerOverdueMep = computeCreatedTermsViolationCustomerOverdueMep;
exports.computeCustomerOverdueBlock = computeCustomerOverdueBlock;
exports.computeCreatedTermsViolationCustomerExcludedFromPolicy = computeCreatedTermsViolationCustomerExcludedFromPolicy;
exports.computeCreatedTermsViolationOutdatedDcl = computeCreatedTermsViolationOutdatedDcl;
exports.computeCreatedTermsViolationInvoiceAfterPolicyEnd = computeCreatedTermsViolationInvoiceAfterPolicyEnd;
exports.computeCreatedTermsViolationSnapshot = computeCreatedTermsViolationSnapshot;
exports.computeInvoiceInsuranceRowData = computeInvoiceInsuranceRowData;
exports.computeCustomerCapacityGapAmount = computeCustomerCapacityGapAmount;
exports.computeCustomerCapacityGapAmountForAccountDisplay = computeCustomerCapacityGapAmountForAccountDisplay;
exports.computeCustomerRiskExposure = computeCustomerRiskExposure;
exports.computeLimitExcessOverEffective = computeLimitExcessOverEffective;
exports.isNearLimitUtilizationWarning = isNearLimitUtilizationWarning;
exports.computeInvoiceCapacityGapContribution = computeInvoiceCapacityGapContribution;
exports.invoiceOutstandingLeft = invoiceOutstandingLeft;
exports.invoiceOutstandingInLimitCurrency = invoiceOutstandingInLimitCurrency;
exports.invoiceOutstandingInAccountCurrency = invoiceOutstandingInAccountCurrency;
exports.computeLimitAssessedAmountForNewOpenInvoice = computeLimitAssessedAmountForNewOpenInvoice;
exports.sumInvoiceCapacityGapContributions = sumInvoiceCapacityGapContributions;
const date_fns_1 = require("date-fns");
const client_1 = require("@prisma/client");
const customerOutdatedDcl_1 = require("./customerOutdatedDcl");
const policyGapAmounts_1 = require("./policyGapAmounts");
const policyExclusion_1 = require("./policyExclusion");
function parseImportDateToLocalCalendarDate(value) {
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
function computePaymentTermDays(invoiceDate, dueDate) {
    if (!invoiceDate || !dueDate) {
        return null;
    }
    return (0, date_fns_1.differenceInCalendarDays)(dueDate, invoiceDate);
}
function addCalendarDaysToDate(base, days) {
    if (!base || days === null || days === undefined) {
        return null;
    }
    return (0, date_fns_1.addDays)(base, days);
}
function calendarDayOfMonthForCutoff(d) {
    return normalizeCalendarDayForInsuranceCompare(d).getDate();
}
function calendarYearAndMonth(d) {
    const norm = normalizeCalendarDayForInsuranceCompare(d);
    return { year: norm.getFullYear(), month: norm.getMonth() };
}
function utcCalendarDate(year, month, day) {
    return new Date(Date.UTC(year, month, day));
}
function lastDayOfUtcCalendarMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
function substituteAnchorInMonthAfter(referenceDate, substituteDayOfMonth) {
    const { year, month } = calendarYearAndMonth(referenceDate);
    let targetYear = year;
    let targetMonth = month + 1;
    if (targetMonth > 11) {
        targetMonth = 0;
        targetYear += 1;
    }
    const targetDay = Math.min(substituteDayOfMonth, lastDayOfUtcCalendarMonth(targetYear, targetMonth));
    return utcCalendarDate(targetYear, targetMonth, targetDay);
}
function computeMonthEndCutoffDiffIfApplicable(args) {
    const { invoiceDate, cutoffDayOfMonth, substituteDayOfMonth } = args;
    if (cutoffDayOfMonth == null ||
        substituteDayOfMonth == null ||
        invoiceDate == null) {
        return null;
    }
    if (calendarDayOfMonthForCutoff(invoiceDate) < cutoffDayOfMonth) {
        return null;
    }
    const substituteDate = substituteAnchorInMonthAfter(invoiceDate, substituteDayOfMonth);
    return (0, date_fns_1.differenceInCalendarDays)(substituteDate, invoiceDate);
}
function applyMonthEndCutoffAdjustment(args) {
    const { dueDate, offsetDays, invoiceDate, cutoffDayOfMonth, substituteDayOfMonth, } = args;
    if (!dueDate || offsetDays === null || offsetDays === undefined) {
        return null;
    }
    if (cutoffDayOfMonth == null ||
        substituteDayOfMonth == null ||
        invoiceDate == null) {
        return addCalendarDaysToDate(dueDate, offsetDays);
    }
    if (calendarDayOfMonthForCutoff(invoiceDate) < cutoffDayOfMonth) {
        return addCalendarDaysToDate(dueDate, offsetDays);
    }
    const substituteDate = substituteAnchorInMonthAfter(invoiceDate, substituteDayOfMonth);
    const diff = (0, date_fns_1.differenceInCalendarDays)(substituteDate, invoiceDate);
    return addCalendarDaysToDate(dueDate, offsetDays + diff);
}
function computeTargetReportingDate(dueDate, reportingDays, monthEnd) {
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
function computeTargetMepDate(dueDate, maxAllowedMep, monthEnd) {
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
function computePaymentTermBreach(invoiceDate, dueDate, maxPaymentTerm, monthEnd) {
    const creditDays = computePaymentTermDays(invoiceDate, dueDate);
    if (creditDays === null ||
        maxPaymentTerm === null ||
        maxPaymentTerm === undefined) {
        return false;
    }
    const diff = computeMonthEndCutoffDiffIfApplicable({
        invoiceDate: monthEnd?.invoiceDate ?? invoiceDate,
        cutoffDayOfMonth: monthEnd?.cutoffDayOfMonth,
        substituteDayOfMonth: monthEnd?.substituteDayOfMonth,
    });
    const effectiveCap = diff !== null ? maxPaymentTerm + diff : maxPaymentTerm;
    return creditDays > effectiveCap;
}
function startOfUtcDay(d) {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
}
function normalizeCalendarDayForInsuranceCompare(d) {
    const utcMidnight = d.getUTCHours() === 0 &&
        d.getUTCMinutes() === 0 &&
        d.getUTCSeconds() === 0 &&
        d.getUTCMilliseconds() === 0;
    if (utcMidnight) {
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isTargetReportingDateBeforeToday(targetReportingDate, today = new Date()) {
    const todayNorm = normalizeCalendarDayForInsuranceCompare(today);
    const targetNorm = normalizeCalendarDayForInsuranceCompare(targetReportingDate);
    return (0, date_fns_1.differenceInCalendarDays)(todayNorm, targetNorm) > 0;
}
function shouldSetReportingBreach(status, targetReportingDate, actualReportingDate, today = new Date()) {
    if (status !== "Due" && status !== "Overdue") {
        return false;
    }
    if (!targetReportingDate || actualReportingDate) {
        return false;
    }
    return isTargetReportingDateBeforeToday(targetReportingDate, today);
}
function computeCustomerTotalAr(customer) {
    const due = new client_1.Prisma.Decimal(customer.total_due_amount ?? 0);
    const overdue = new client_1.Prisma.Decimal(customer.total_overdue_amount ?? 0);
    return due.plus(overdue);
}
function computeUninsuredAmount(customer) {
    const display = (0, policyGapAmounts_1.readUninsuredAmountForDisplay)(customer);
    if (display == null) {
        return null;
    }
    return new client_1.Prisma.Decimal(display);
}
function computeCreatedTermsViolationCustomerOverdueMep(customerOverdueBlock) {
    return customerOverdueBlock === true;
}
function computeCustomerOverdueBlock(args) {
    const { oldestInvoiceOverdueDate, maxAllowedMepDays } = args;
    const today = args.today ?? new Date();
    if (!oldestInvoiceOverdueDate ||
        maxAllowedMepDays === null ||
        maxAllowedMepDays === undefined) {
        return false;
    }
    const customerMepDeadline = (0, date_fns_1.addDays)(oldestInvoiceOverdueDate, maxAllowedMepDays);
    return (0, date_fns_1.differenceInCalendarDays)(today, customerMepDeadline) > 0;
}
function computeCreatedTermsViolationCustomerExcludedFromPolicy(exclusionReason) {
    return (0, policyExclusion_1.isCustomerPolicyExcluded)(exclusionReason);
}
function computeCreatedTermsViolationOutdatedDcl(invoiceDate, creditScoreInputDate, scoreValidityPeriodMonths) {
    return (0, customerOutdatedDcl_1.computeOutdatedDclAtEvaluation)({
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
function computeCreatedTermsViolationInvoiceAfterPolicyEnd(invoiceDate, policyEndDate) {
    if (!policyEndDate) {
        return false;
    }
    const inv = normalizeCalendarDayForInsuranceCompare(invoiceDate);
    const pol = normalizeCalendarDayForInsuranceCompare(policyEndDate);
    return (0, date_fns_1.differenceInCalendarDays)(inv, pol) >= 0;
}
function computeCreatedTermsViolationSnapshot(args) {
    const ctv_customer_overdue_mep = computeCreatedTermsViolationCustomerOverdueMep(args.customer.overdue_block);
    const ctv_customer_excluded_from_policy = computeCreatedTermsViolationCustomerExcludedFromPolicy(args.customer.policy_exclusion_reason);
    const ctv_outdated_dcl = (0, customerOutdatedDcl_1.computeOutdatedDclAtEvaluation)({
        limitType: args.customer.limit_type ?? null,
        evaluationDate: args.invoice_date,
        creditScore: args.customer.credit_score ?? null,
        minCreditScore: args.policy?.min_credit_score ?? null,
        creditScoreInputDate: args.customer.credit_score_input_date,
        scoreValidityPeriodMonths: args.policy?.score_validity_period_months ?? null,
        activeCustomerSince: args.customer.active_customer_since ?? null,
        dclCustomerSinceMonths: args.policy?.dcl_customer_since_months ?? null,
    });
    const ctv_invoice_after_policy_end = computeCreatedTermsViolationInvoiceAfterPolicyEnd(args.invoice_date, args.policy?.end_date ?? null);
    return {
        ctv_customer_overdue_mep,
        ctv_customer_excluded_from_policy,
        ctv_outdated_dcl,
        ctv_invoice_after_policy_end,
    };
}
function computeInvoiceInsuranceRowData(args) {
    const today = args.today ?? new Date();
    const payment_term = args.explicitPaymentTerm !== undefined && args.explicitPaymentTerm !== null
        ? args.explicitPaymentTerm
        : computePaymentTermDays(args.invoice_date, args.due_date);
    const target_reporting_date = computeTargetReportingDate(args.due_date, args.customer.reporting_days, {
        invoiceDate: args.invoice_date,
        cutoffDayOfMonth: args.customer.reporting_cutoff_day_of_month,
        substituteDayOfMonth: args.customer.reporting_substitute_day_of_month,
    });
    const target_mep_date = computeTargetMepDate(args.due_date, args.customer.max_allowed_mep, {
        invoiceDate: args.invoice_date,
        cutoffDayOfMonth: args.customer.mep_cutoff_day_of_month,
        substituteDayOfMonth: args.customer.mep_substitute_day_of_month,
    });
    const reporting_breach = shouldSetReportingBreach(args.status, target_reporting_date, args.actual_reporting_date ?? null, today);
    const ctv_payment_term = computePaymentTermBreach(args.invoice_date, args.due_date, args.customer.max_payment_term, {
        invoiceDate: args.invoice_date,
        cutoffDayOfMonth: args.customer.payment_term_cutoff_day_of_month,
        substituteDayOfMonth: args.customer.payment_term_substitute_day_of_month,
    });
    return {
        payment_term,
        target_reporting_date,
        target_mep_date,
        reporting_breach,
        ctv_payment_term,
    };
}
function computeCustomerCapacityGapAmount(customer) {
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
    const limitDec = new client_1.Prisma.Decimal(lim);
    const diff = ar.sub(limitDec);
    if (diff.lte(0)) {
        return 0;
    }
    return diff.toNumber();
}
function computeCustomerCapacityGapAmountForAccountDisplay(customer, _accountCurrency) {
    return (0, policyGapAmounts_1.storedCapacityGapAmount)(customer);
}
function computeCustomerRiskExposure(args) {
    const ar = Math.max(0, args.totalAr);
    if (ar <= 0) {
        return 0;
    }
    const termsBreach = Math.max(0, args.termsBreachOutstanding);
    const gap = Math.max(0, args.capacityGapAmount);
    return Math.min(ar, gap + termsBreach);
}
function computeLimitExcessOverEffective(totalAr, effectiveApprovedLimit) {
    const ar = Math.max(0, totalAr);
    const effective = Math.max(0, Number(effectiveApprovedLimit ?? 0));
    if (effective <= 0) {
        return 0;
    }
    return Math.max(0, ar - effective);
}
function isNearLimitUtilizationWarning(input) {
    const ar = Math.max(0, input.ar);
    if (ar <= 0) {
        return false;
    }
    const approved = Number(input.approvedLimit ?? 0);
    if (input.approvedLimit == null || approved <= 0) {
        return false;
    }
    const useEffective = input.useEffectiveLimit === true &&
        input.effectiveLimitInAccountCurrency != null &&
        input.effectiveLimitInAccountCurrency > 0;
    const limitForCheck = useEffective
        ? input.effectiveLimitInAccountCurrency
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
function computeInvoiceCapacityGapContribution(args) {
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
function invoiceOutstandingLeft(row) {
    if (row.customer_outstanding_debt != null &&
        row.customer_outstanding_debt !== 0) {
        return Number(row.customer_outstanding_debt);
    }
    if (row.outstanding_debt != null && row.outstanding_debt !== 0) {
        return Number(row.outstanding_debt);
    }
    return Number(row.amount ?? 0);
}
function invoiceOutstandingInLimitCurrency(row) {
    const limitCcy = row.limit_assessed_currency?.trim().toUpperCase() ?? null;
    const acct = row.accountCurrency?.trim().toUpperCase() ?? null;
    const customerCcy = row.customer_currency?.trim().toUpperCase() ?? null;
    if (limitCcy && acct && limitCcy === acct) {
        return invoiceOutstandingInAccountCurrency(row);
    }
    if (limitCcy &&
        customerCcy &&
        limitCcy !== customerCcy &&
        row.outstanding_debt != null &&
        row.outstanding_debt !== 0) {
        return Number(row.outstanding_debt);
    }
    return invoiceOutstandingLeft(row);
}
function invoiceOutstandingInAccountCurrency(row) {
    if (row.outstanding_debt != null && row.outstanding_debt !== 0) {
        return Number(row.outstanding_debt);
    }
    if (row.customer_outstanding_debt != null &&
        row.customer_outstanding_debt !== 0) {
        return Number(row.customer_outstanding_debt);
    }
    return Number(row.amount ?? 0);
}
function computeLimitAssessedAmountForNewOpenInvoice(args) {
    const approved = args.approvedLimit == null ? null : Number(args.approvedLimit);
    const openBefore = Math.max(0, Number(args.openArOnPolicyBeforeInvoice ?? 0));
    const topUp = Math.max(0, Number(args.topUpTotal ?? 0));
    if (approved == null || !Number.isFinite(approved) || approved <= 0) {
        return 0;
    }
    const approvedHeadroom = Math.max(0, approved - openBefore);
    const topUpHeadroom = openBefore < approved
        ? topUp
        : Math.max(0, topUp - (openBefore - approved));
    const newOutstanding = args.newInvoiceOutstanding;
    if (newOutstanding == null ||
        !Number.isFinite(Number(newOutstanding))) {
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
function sumInvoiceCapacityGapContributions(invoices) {
    if (invoices.length === 0) {
        return { total: 0, hasMissingSnapshots: false };
    }
    const hasMissingSnapshots = invoices.some((inv) => inv.limit_assessed_amount == null);
    if (hasMissingSnapshots) {
        return { total: null, hasMissingSnapshots: true };
    }
    const hasStoredGaps = invoices.some((inv) => inv.capacity_gap_amount_limit != null ||
        inv.capacity_gap_amount != null);
    const total = invoices.reduce((sum, inv) => {
        if (hasStoredGaps && inv.capacity_gap_amount_limit != null) {
            return sum + Math.max(0, Number(inv.capacity_gap_amount_limit));
        }
        return (sum +
            computeInvoiceCapacityGapContribution({
                outstandingLeft: invoiceOutstandingLeft(inv),
                limitAssessedAmount: Number(inv.limit_assessed_amount ?? 0),
            }));
    }, 0);
    return { total, hasMissingSnapshots: false };
}
//# sourceMappingURL=invoiceInsuranceFields.js.map