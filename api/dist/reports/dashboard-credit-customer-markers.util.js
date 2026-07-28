"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD = exports.CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD = void 0;
exports.parseCreditDashboardCustomerScopeValue = parseCreditDashboardCustomerScopeValue;
exports.parseCreditDashboardCustomerMembershipValue = parseCreditDashboardCustomerMembershipValue;
exports.prepareDashboardCreditCustomerMarkers = prepareDashboardCreditCustomerMarkers;
const customerPolicyQueryHelpers_1 = require("../credit-insurance/domain/customerPolicyQueryHelpers");
const creditDashboardCustomerMembership_1 = require("../credit-insurance/domain/creditDashboardCustomerMembership");
exports.CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD = "__credit_dashboard_customer_scope";
exports.CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD = "__credit_dashboard_customer_membership";
function andWhere(parts) {
    const defined = parts.filter((p) => p != null && Object.keys(p).length > 0);
    if (defined.length === 0) {
        return undefined;
    }
    if (defined.length === 1) {
        return defined[0];
    }
    return { AND: defined };
}
function parseCreditDashboardCustomerScopeValue(value) {
    if (value == null || value === "" || value === "all") {
        return undefined;
    }
    const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    return Number.isFinite(n) ? n : undefined;
}
function parseCreditDashboardCustomerMembershipValue(value) {
    const raw = value == null ? "" : String(value);
    if (raw === "capacity" ||
        raw === "policy_risk" ||
        raw === "limit_warning" ||
        raw === "zero_limit_warning" ||
        raw === "top_up") {
        return {
            type: raw,
            includeNoPolicyExposure: true,
            withinDays: null,
        };
    }
    if (raw === "no_policy_exposure") {
        return {
            type: "no_policy_exposure",
            includeNoPolicyExposure: true,
            withinDays: null,
        };
    }
    if (raw === "no_policy_exposure:0") {
        return {
            type: "no_policy_exposure",
            includeNoPolicyExposure: false,
            withinDays: null,
        };
    }
    if (raw === "top_up_expiring") {
        return {
            type: "top_up_expiring",
            includeNoPolicyExposure: true,
            withinDays: 30,
        };
    }
    if (raw.startsWith("top_up_expiring:")) {
        const days = Number.parseInt(raw.slice("top_up_expiring:".length), 10);
        return {
            type: "top_up_expiring",
            includeNoPolicyExposure: true,
            withinDays: Number.isFinite(days) ? Math.max(1, days) : 30,
        };
    }
    return {
        type: null,
        includeNoPolicyExposure: true,
        withinDays: null,
    };
}
async function prepareDashboardCreditCustomerMarkers(filters, options) {
    if (!filters?.length) {
        return { filters: filters ?? [] };
    }
    let working = [...filters];
    let scopeWhere;
    let membershipWhere;
    let policyId;
    let withinDays;
    let membershipType;
    const scopeIndex = working.findIndex((f) => f.table === "Customer" &&
        f.field === exports.CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD);
    if (scopeIndex >= 0) {
        const marker = working[scopeIndex];
        policyId = parseCreditDashboardCustomerScopeValue(marker.value);
        scopeWhere = (0, customerPolicyQueryHelpers_1.customersScopedForCreditDashboard)(options.accountId, policyId);
        working = working.filter((_, i) => i !== scopeIndex);
        const membershipIndex = working.findIndex((f) => f.table === "Customer" &&
            f.field === exports.CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD);
        if (membershipIndex >= 0) {
            const membershipMarker = working[membershipIndex];
            const parsed = parseCreditDashboardCustomerMembershipValue(membershipMarker.value);
            membershipType = parsed.type;
            if (parsed.type === "top_up_expiring") {
                withinDays = parsed.withinDays ?? 30;
            }
            working = working.filter((_, i) => i !== membershipIndex);
            if (parsed.type === "zero_limit_warning") {
                membershipWhere = (0, creditDashboardCustomerMembership_1.zeroLimitWarningMembershipWhere)({
                    policyId,
                });
            }
            else if (parsed.type != null) {
                const customerIdFilter = working.find((f) => f.table === "Customer" &&
                    f.field === "id" &&
                    f.operator === "equals");
                const customerId = customerIdFilter != null &&
                    Number.isFinite(Number(customerIdFilter.value))
                    ? Number(customerIdFilter.value)
                    : undefined;
                const ids = await (0, creditDashboardCustomerMembership_1.resolveCreditCustomerMembershipIds)(parsed.type, options.accountId, {
                    policyId,
                    customerId,
                    includeNoPolicyExposure: parsed.includeNoPolicyExposure,
                    withinDays: parsed.withinDays ?? undefined,
                });
                membershipWhere = {
                    id: { in: ids ?? [] },
                };
            }
        }
    }
    else {
        working = working.filter((f) => !(f.table === "Customer" &&
            f.field ===
                exports.CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD));
    }
    return {
        filters: working,
        primaryWhereExtras: andWhere([scopeWhere, membershipWhere]),
        policyId,
        withinDays,
        membershipType,
    };
}
//# sourceMappingURL=dashboard-credit-customer-markers.util.js.map