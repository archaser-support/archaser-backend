"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREDIT_DASHBOARD_INVOICE_MEMBERSHIP_FILTER_FIELD = void 0;
exports.parseCreditDashboardInvoiceMembershipValue = parseCreditDashboardInvoiceMembershipValue;
exports.prepareDashboardCreditInvoiceMarkers = prepareDashboardCreditInvoiceMarkers;
const creditDashboardInvoiceMembership_1 = require("../credit-insurance/domain/creditDashboardInvoiceMembership");
exports.CREDIT_DASHBOARD_INVOICE_MEMBERSHIP_FILTER_FIELD = "__credit_dashboard_invoice_membership";
function parseCreditDashboardInvoiceMembershipValue(value) {
    const raw = value == null ? "" : String(value);
    if (raw === "reporting" || raw === "reported") {
        return {
            type: raw,
            termsBreachReason: null,
            termsOverdueOnly: false,
        };
    }
    if (raw === "terms") {
        return {
            type: "terms",
            termsBreachReason: null,
            termsOverdueOnly: false,
        };
    }
    if (raw.startsWith("terms:")) {
        const rest = raw.slice("terms:".length);
        const segments = rest.split(":").filter(Boolean);
        let termsOverdueOnly = false;
        let termsBreachReason = null;
        for (const seg of segments) {
            if (seg === "overdue") {
                termsOverdueOnly = true;
            }
            else {
                termsBreachReason = seg;
            }
        }
        return { type: "terms", termsBreachReason, termsOverdueOnly };
    }
    return {
        type: null,
        termsBreachReason: null,
        termsOverdueOnly: false,
    };
}
async function prepareDashboardCreditInvoiceMarkers(filters, options) {
    if (!filters?.length) {
        return { filters: filters ?? [] };
    }
    const membershipIndex = filters.findIndex((f) => f.table === "Invoice" &&
        f.field === exports.CREDIT_DASHBOARD_INVOICE_MEMBERSHIP_FILTER_FIELD);
    if (membershipIndex < 0) {
        return { filters };
    }
    const marker = filters[membershipIndex];
    const parsed = parseCreditDashboardInvoiceMembershipValue(marker.value);
    const rest = filters.filter((_, i) => i !== membershipIndex);
    if (!parsed.type) {
        return { filters: rest };
    }
    const policyIdFilter = rest.find((f) => f.table === "Invoice" &&
        f.field === "policy_id" &&
        f.operator === "equals");
    const customerIdFilter = rest.find((f) => f.table === "Invoice" &&
        f.field === "customer_id" &&
        f.operator === "equals");
    const policyId = policyIdFilter != null && Number.isFinite(Number(policyIdFilter.value))
        ? Number(policyIdFilter.value)
        : undefined;
    const customerId = customerIdFilter != null &&
        Number.isFinite(Number(customerIdFilter.value))
        ? Number(customerIdFilter.value)
        : undefined;
    const stripScopeFilters = (list) => list.filter((f) => !(f.table === "Invoice" &&
        (f.field === "policy_id" || f.field === "customer_id")));
    if (parsed.type === "terms") {
        return {
            filters: stripScopeFilters(rest),
            primaryWhereExtras: (0, creditDashboardInvoiceMembership_1.termsBreachMembershipWhere)(options.accountId, {
                termsBreachReason: parsed.termsBreachReason,
                termsOverdueOnly: parsed.termsOverdueOnly,
                policyId,
                customerId,
            }),
        };
    }
    if (parsed.type === "reporting") {
        const windowDays = await (0, creditDashboardInvoiceMembership_1.resolveReportingCountdownWindowDays)(options.accountId);
        return {
            filters: stripScopeFilters(rest),
            primaryWhereExtras: (0, creditDashboardInvoiceMembership_1.reportingCountdownMembershipWhere)(options.accountId, windowDays, { policyId, customerId }),
        };
    }
    return {
        filters: stripScopeFilters(rest),
        primaryWhereExtras: (0, creditDashboardInvoiceMembership_1.reportedInvoicesMembershipWhere)(options.accountId, {
            policyId,
            customerId,
        }),
    };
}
//# sourceMappingURL=dashboard-credit-invoice-markers.util.js.map