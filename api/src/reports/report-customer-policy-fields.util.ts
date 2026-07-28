/** Fields resolved from active CustomerPolicy (not Customer table columns). */
export const CUSTOMER_POLICY_BACKED_REPORT_FIELDS = new Set([
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

export function isCustomerPolicyBackedReportField(field: string): boolean {
    return (
        field === "policy_id" ||
        field === "InsurancePolicy.policy_number" ||
        field === "registration_fee_percent" ||
        field.startsWith("InsurancePolicy.") ||
        CUSTOMER_POLICY_BACKED_REPORT_FIELDS.has(field)
    );
}

type CustomerPolicyRow = Record<string, unknown> & {
    InsurancePolicy?: Record<string, unknown> | null;
    is_active?: boolean;
    insurance_policy_id?: number | null;
};

export function getCustomerPolicyRow(
    row: unknown,
    invoiceRow?: unknown
): CustomerPolicyRow | null {
    if (!row || typeof row !== "object") {
        return null;
    }
    const customerPolicy = (row as { CustomerPolicy?: unknown }).CustomerPolicy;
    if (!customerPolicy) {
        return null;
    }

    const policies = Array.isArray(customerPolicy)
        ? customerPolicy
        : [customerPolicy];

    const validPolicies = policies.filter(
        (p): p is CustomerPolicyRow => p && typeof p === "object"
    );

    if (validPolicies.length === 0) {
        return null;
    }

    if (invoiceRow && typeof invoiceRow === "object") {
        const policyId = (invoiceRow as { policy_id?: unknown }).policy_id;
        if (typeof policyId === "number") {
            const matched = validPolicies.find(
                (p) =>
                    (p as { insurance_policy_id?: unknown })
                        .insurance_policy_id === policyId
            );
            if (matched) {
                return matched;
            }
        }
    }

    const active = validPolicies.find(
        (p) => (p as { is_active?: unknown }).is_active === true
    );
    if (active) {
        return active;
    }

    return validPolicies[0];
}

export function extractCustomerPolicyReportField(
    row: unknown,
    field: string,
    invoiceRow?: unknown
): unknown {
    const active = getCustomerPolicyRow(row, invoiceRow);
    if (!active) {
        return null;
    }

    if (field === "policy_id" || field === "InsurancePolicy.policy_number") {
        return active.InsurancePolicy?.policy_number ?? null;
    }

    if (field === "registration_fee_percent") {
        const raw =
            active.registration_fee_percent ??
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
                const n = (raw as { toNumber: () => number }).toNumber();
                return Number.isFinite(n) ? n : null;
            } catch {
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

function mergePolicySelectFields(
    target: Record<string, unknown>,
    field: string
): void {
    if (
        field === "policy_id" ||
        field === "InsurancePolicy.policy_number" ||
        field.startsWith("InsurancePolicy.")
    ) {
        target.insurance_policy_id = true;
        const relationField = field.startsWith("InsurancePolicy.")
            ? field.split(".", 2)[1]
            : "policy_number";
        const existing = target.InsurancePolicy as
            | { select?: Record<string, boolean> }
            | undefined;
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

    if (CUSTOMER_POLICY_BACKED_REPORT_FIELDS.has(field)) {
        target[field] = true;
        if (field === "approved_limit") {
            target.approved_limit_currency = true;
            const existingPolicy = target.InsurancePolicy as
                | { select?: Record<string, boolean> }
                | undefined;
            if (!existingPolicy) {
                target.InsurancePolicy = { select: { currency: true } };
            } else if (!existingPolicy.select) {
                existingPolicy.select = { currency: true };
            } else {
                existingPolicy.select.currency = true;
            }
        }
    }
}

export function mergeActiveCustomerPolicySelect(
    select: Record<string, unknown>,
    fields: string[]
): void {
    const policySelect: Record<string, unknown> = {};
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

    const existing = select.CustomerPolicy as
        | {
              where?: { is_active?: boolean };
              take?: number;
              select?: Record<string, unknown>;
          }
        | undefined;

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
        if (key === "InsurancePolicy" && existing.select!.InsurancePolicy) {
            const merged = existing.select!.InsurancePolicy as {
                select?: Record<string, boolean>;
            };
            const incoming = value as { select?: Record<string, boolean> };
            merged.select = {
                ...merged.select,
                ...incoming.select,
            };
            continue;
        }
        existing.select![key] = value;
    }

    delete existing.where;
    delete existing.take;
}
