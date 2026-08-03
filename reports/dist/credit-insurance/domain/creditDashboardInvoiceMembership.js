"use strict";
/**
 * Invoice-grain membership where fragments for credit dashboard ViewBased execute.
 * Mirrors getTermsBreachReport / getReportingCountdownOpenReport / getReportedInvoicesReport
 * (without search text — execute search handles that; without BU — execute applies it).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMS_BREACH_REASON_FIELDS = void 0;
exports.isTermsBreachReasonField = isTermsBreachReasonField;
exports.termsBreachMembershipWhere = termsBreachMembershipWhere;
exports.reportingCountdownMembershipWhere = reportingCountdownMembershipWhere;
exports.reportedInvoicesMembershipWhere = reportedInvoicesMembershipWhere;
exports.resolveReportingCountdownWindowDays = resolveReportingCountdownWindowDays;
const client_1 = require("@prisma/client");
const date_fns_1 = require("date-fns");
const domain_db_1 = require("../domain-db");
const TERMS_BREACH_OR = [
    { reporting_breach: true },
    { ctv_payment_term: true },
    { ctv_customer_overdue_mep: true },
    { ctv_outdated_dcl: true },
    { ctv_invoice_after_policy_end: true },
];
exports.TERMS_BREACH_REASON_FIELDS = [
    "reporting_breach",
    "ctv_payment_term",
    "ctv_customer_overdue_mep",
    "ctv_outdated_dcl",
    "ctv_invoice_after_policy_end",
];
function isTermsBreachReasonField(value) {
    return (!!value &&
        exports.TERMS_BREACH_REASON_FIELDS.includes(value));
}
/** Base terms-breach membership (no search, no BU). */
function termsBreachMembershipWhere(accountId, options = {}) {
    const statusFilter = options.termsOverdueOnly
        ? { status: client_1.invoice_status.Overdue }
        : { status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] } };
    const reason = options.termsBreachReason;
    const breachFilter = reason && isTermsBreachReasonField(reason)
        ? { [reason]: true }
        : { OR: TERMS_BREACH_OR };
    return {
        account_id: accountId,
        ...statusFilter,
        ...breachFilter,
        Customer: { isNot: null },
        ...(options.policyId != null ? { policy_id: options.policyId } : {}),
        ...(options.customerId != null
            ? { customer_id: options.customerId }
            : {}),
    };
}
/** Open reporting-countdown membership (no search, no BU). */
function reportingCountdownMembershipWhere(accountId, windowDays, options = {}) {
    const today = (0, date_fns_1.startOfDay)(new Date());
    const lastInclusive = (0, date_fns_1.addDays)(today, Math.max(0, windowDays));
    return {
        account_id: accountId,
        status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] },
        target_reporting_date: { gte: today, lte: lastInclusive },
        actual_reporting_date: null,
        reporting_breach: false,
        ...(options.policyId != null ? { policy_id: options.policyId } : {}),
        ...(options.customerId != null
            ? { customer_id: options.customerId }
            : {}),
    };
}
/** Reported invoices membership (no search, no BU). */
function reportedInvoicesMembershipWhere(accountId, options = {}) {
    return {
        account_id: accountId,
        actual_reporting_date: { not: null },
        Customer: { isNot: null },
        ...(options.policyId != null ? { policy_id: options.policyId } : {}),
        ...(options.customerId != null
            ? { customer_id: options.customerId }
            : {}),
    };
}
const DEFAULT_REPORTING_WINDOW_DAYS = 14;
async function resolveReportingCountdownWindowDays(accountId) {
    const account = await domain_db_1.prisma.account.findUnique({
        where: { id: accountId },
        select: { reporting_date_warning_days: true },
    });
    const days = account?.reporting_date_warning_days;
    if (days == null || !Number.isFinite(Number(days))) {
        return DEFAULT_REPORTING_WINDOW_DAYS;
    }
    return Math.max(0, Number(days));
}
