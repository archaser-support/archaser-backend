"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOMER_POLICY_BACKED_REPORT_FIELDS = void 0;
exports.isCustomerPolicyBackedReportField = isCustomerPolicyBackedReportField;
exports.getCustomerPolicyRow = getCustomerPolicyRow;
exports.extractCustomerPolicyReportField = extractCustomerPolicyReportField;
exports.mergeActiveCustomerPolicySelect = mergeActiveCustomerPolicySelect;
exports.CUSTOMER_POLICY_BACKED_REPORT_FIELDS = new Set([
    "customer_number_policy",
    "approved_limit",
    "approved_limit_expiration_date",
    "limit_type",
    "max_payment_term",
    "max_allowed_mep",
    "reporting_days",
    "policy_exclusion_reason",
    "credit_score",
    "credit_score_input_date",
    "capacity_gap_amount",
    "zero_limit_date",
]);
function isCustomerPolicyBackedReportField(field) {
    return (field === "policy_id" ||
        field === "InsurancePolicy.policy_number" ||
        field === "registration_fee_percent" ||
        field.startsWith("InsurancePolicy.") ||
        exports.CUSTOMER_POLICY_BACKED_REPORT_FIELDS.has(field));
}
function getCustomerPolicyRow(row, invoiceRow) {
    if (!row || typeof row !== "object") {
        return null;
    }
    const customerPolicy = row.CustomerPolicy;
    if (!customerPolicy) {
        return null;
    }
    const policies = Array.isArray(customerPolicy)
        ? customerPolicy
        : [customerPolicy];
    const validPolicies = policies.filter((p) => p && typeof p === "object");
    if (validPolicies.length === 0) {
        return null;
    }
    if (invoiceRow && typeof invoiceRow === "object") {
        const policyId = invoiceRow.policy_id;
        if (typeof policyId === "number") {
            const matched = validPolicies.find((p) => p
                .insurance_policy_id === policyId);
            if (matched) {
                return matched;
            }
        }
    }
    const active = validPolicies.find((p) => p.is_active === true);
    if (active) {
        return active;
    }
    return validPolicies[0];
}
function extractCustomerPolicyReportField(row, field, invoiceRow) {
    const active = getCustomerPolicyRow(row, invoiceRow);
    if (!active) {
        return null;
    }
    if (field === "policy_id" || field === "InsurancePolicy.policy_number") {
        return active.InsurancePolicy?.policy_number ?? null;
    }
    if (field === "registration_fee_percent") {
        const raw = active.registration_fee_percent ??
            active.InsurancePolicy?.registration_fee_percent ??
            null;
        if (raw === null || raw === undefined || raw === "") {
            return null;
        }
        if (typeof raw === "number") {
            return Number.isNaN(raw) ? null : raw;
        }
        if (typeof raw === "object" && raw !== null && "toNumber" in raw) {
            try {
                const n = raw.toNumber();
                return Number.isFinite(n) ? n : null;
            }
            catch {
                return null;
            }
        }
        const n = parseFloat(String(raw));
        return Number.isNaN(n) ? null : n;
    }
    if (field.startsWith("InsurancePolicy.")) {
        const relationField = field.split(".", 2)[1];
        return active.InsurancePolicy?.[relationField] ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(active, field)) {
        return active[field];
    }
    return null;
}
function mergePolicySelectFields(target, field) {
    if (field === "policy_id" ||
        field === "InsurancePolicy.policy_number" ||
        field.startsWith("InsurancePolicy.")) {
        target.insurance_policy_id = true;
        const relationField = field.startsWith("InsurancePolicy.")
            ? field.split(".", 2)[1]
            : "policy_number";
        const existing = target.InsurancePolicy;
        if (!existing) {
            target.InsurancePolicy = {
                select: { [relationField]: true },
            };
            return;
        }
        if (!existing.select) {
            existing.select = { [relationField]: true };
            return;
        }
        existing.select[relationField] = true;
        return;
    }
    if (exports.CUSTOMER_POLICY_BACKED_REPORT_FIELDS.has(field)) {
        target[field] = true;
        if (field === "approved_limit") {
            target.approved_limit_currency = true;
            const existingPolicy = target.InsurancePolicy;
            if (!existingPolicy) {
                target.InsurancePolicy = { select: { currency: true } };
            }
            else if (!existingPolicy.select) {
                existingPolicy.select = { currency: true };
            }
            else {
                existingPolicy.select.currency = true;
            }
        }
    }
}
function mergeActiveCustomerPolicySelect(select, fields) {
    const policySelect = {};
    for (const field of fields) {
        if (isCustomerPolicyBackedReportField(field)) {
            mergePolicySelectFields(policySelect, field);
        }
    }
    if (Object.keys(policySelect).length === 0) {
        return;
    }
    policySelect.insurance_policy_id = true;
    policySelect.is_active = true;
    const existing = select.CustomerPolicy;
    if (!existing) {
        select.CustomerPolicy = {
            select: policySelect,
        };
        return;
    }
    if (!existing.select) {
        existing.select = {};
    }
    for (const [key, value] of Object.entries(policySelect)) {
        if (key === "InsurancePolicy" && existing.select.InsurancePolicy) {
            const merged = existing.select.InsurancePolicy;
            const incoming = value;
            merged.select = {
                ...merged.select,
                ...incoming.select,
            };
            continue;
        }
        existing.select[key] = value;
    }
    delete existing.where;
    delete existing.take;
}
//# sourceMappingURL=report-customer-policy-fields.util.js.map