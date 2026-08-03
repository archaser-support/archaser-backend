"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoiceOutstandingInAccountCurrency = invoiceOutstandingInAccountCurrency;
exports.invoiceMatchesPolicyScope = invoiceMatchesPolicyScope;
exports.invoiceHasTermsBreachFlag = invoiceHasTermsBreachFlag;
exports.aggregateTermsBreachByReasonFromInvoices = aggregateTermsBreachByReasonFromInvoices;
exports.getCustomerTermsBreachByReasonSnapshot = getCustomerTermsBreachByReasonSnapshot;
exports.termsBreachByReasonSnapshotToJson = termsBreachByReasonSnapshotToJson;
const domain_db_1 = require("../domain-db");
const REASON_KEYS = [
    "reportingBreach",
    "paymentTerm",
    "customerOverdueMep",
    "outdatedDcl",
    "invoiceAfterPolicyEnd",
    "other",
];
function emptyBuckets() {
    return {
        reportingBreach: { count: 0, amount: 0 },
        paymentTerm: { count: 0, amount: 0 },
        customerOverdueMep: { count: 0, amount: 0 },
        outdatedDcl: { count: 0, amount: 0 },
        invoiceAfterPolicyEnd: { count: 0, amount: 0 },
        other: { count: 0, amount: 0 },
    };
}
function invoiceOutstandingInAccountCurrency(row) {
    const debt = Number(row.outstanding_debt ?? 0);
    if (debt !== 0) {
        return Math.max(0, debt);
    }
    return Math.max(0, Number(row.customer_outstanding_debt ?? 0));
}
function invoiceMatchesPolicyScope(policyId, scope) {
    if (scope === undefined) {
        return true;
    }
    if (scope === null) {
        return policyId == null;
    }
    return policyId === scope;
}
function invoiceHasTermsBreachFlag(invoice) {
    return (invoice.reportingBreach ||
        invoice.ctvPaymentTerm ||
        invoice.ctvCustomerOverdueMep ||
        invoice.ctvOutdatedDcl ||
        invoice.ctvInvoiceAfterPolicyEnd);
}
function compactTermsBreachByReasonSnapshot(buckets) {
    const snapshot = {};
    for (const key of REASON_KEYS) {
        const bucket = buckets[key];
        if (bucket.count > 0 || bucket.amount > 0) {
            snapshot[key] = {
                count: bucket.count,
                amount: bucket.amount,
            };
        }
    }
    return snapshot;
}
/**
 * Pure aggregator: Due/Overdue breach invoices → count + amount per reason.
 * Multi-flag invoices contribute to each applicable bucket (full outstanding each time).
 */
function aggregateTermsBreachByReasonFromInvoices(invoices, policyScope) {
    const buckets = emptyBuckets();
    for (const invoice of invoices) {
        if (!invoiceMatchesPolicyScope(invoice.policyId, policyScope)) {
            continue;
        }
        if (!invoiceHasTermsBreachFlag(invoice)) {
            continue;
        }
        const outstanding = Math.max(0, invoice.outstanding);
        const flags = [
            ["reportingBreach", invoice.reportingBreach],
            ["paymentTerm", invoice.ctvPaymentTerm],
            ["customerOverdueMep", invoice.ctvCustomerOverdueMep],
            ["outdatedDcl", invoice.ctvOutdatedDcl],
            ["invoiceAfterPolicyEnd", invoice.ctvInvoiceAfterPolicyEnd],
        ];
        let matchedKnownReason = false;
        for (const [key, isOn] of flags) {
            if (!isOn) {
                continue;
            }
            matchedKnownReason = true;
            buckets[key].count += 1;
            buckets[key].amount += outstanding;
        }
        if (!matchedKnownReason) {
            buckets.other.count += 1;
            buckets.other.amount += outstanding;
        }
    }
    return compactTermsBreachByReasonSnapshot(buckets);
}
/**
 * Live breach invoices for one customer, optionally scoped to one insurance policy
 * (`null` = invoices with no `policy_id`).
 */
async function getCustomerTermsBreachByReasonSnapshot(accountId, customerId, policyId) {
    const rows = await domain_db_1.prisma.invoice.findMany({
        where: {
            account_id: accountId,
            customer_id: customerId,
            status: { in: ["Due", "Overdue"] },
            ...(policyId === null
                ? { policy_id: null }
                : { policy_id: policyId }),
            OR: [
                { reporting_breach: true },
                { ctv_payment_term: true },
                { ctv_customer_overdue_mep: true },
                { ctv_outdated_dcl: true },
                { ctv_invoice_after_policy_end: true },
            ],
        },
        select: {
            policy_id: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            reporting_breach: true,
            ctv_payment_term: true,
            ctv_customer_overdue_mep: true,
            ctv_outdated_dcl: true,
            ctv_invoice_after_policy_end: true,
        },
    });
    const invoices = rows.map((row) => ({
        policyId: row.policy_id,
        outstanding: invoiceOutstandingInAccountCurrency(row),
        reportingBreach: row.reporting_breach,
        ctvPaymentTerm: row.ctv_payment_term,
        ctvCustomerOverdueMep: row.ctv_customer_overdue_mep,
        ctvOutdatedDcl: row.ctv_outdated_dcl,
        ctvInvoiceAfterPolicyEnd: row.ctv_invoice_after_policy_end,
    }));
    return {
        snapshot: aggregateTermsBreachByReasonFromInvoices(invoices, policyId),
        invoiceCount: invoices.length,
    };
}
function termsBreachByReasonSnapshotToJson(snapshot) {
    return snapshot;
}
