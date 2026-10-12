import { planPolicyPushToCustomers } from "../src/credit-insurance/domain/policyPushCustomerPlan";

const policyBefore = {
    max_payment_term: 180,
    cost_percent: "0.25",
    reporting_days: 30,
};

function row(customer_id: number, overrides: Record<string, unknown> = {}) {
    return {
        id: customer_id * 10,
        customer_id,
        max_payment_term: 120,
        cost_percent: "0.25",
        reporting_days: 30,
        ...overrides,
    };
}

describe("planPolicyPushToCustomers", () => {
    it("returns no changed fields and no versions when no push field changed", () => {
        const plan = planPolicyPushToCustomers({
            policyBefore,
            policyAfter: { ...policyBefore },
            activeRows: [row(1), row(2)],
            pendingCustomerIds: new Set(),
            alwaysAlignFields: [],
        });
        expect(plan.fieldsToPush).toEqual([]);
        expect(plan.rowsToVersion).toEqual([]);
        expect(plan.uniqueCustomerCount).toBe(0);
        expect(plan.skippedPendingCustomerCount).toBe(0);
    });

    it("compares customers only on fields that changed on the policy", () => {
        const plan = planPolicyPushToCustomers({
            policyBefore,
            policyAfter: { ...policyBefore, cost_percent: 0.3 },
            activeRows: [row(1), row(2, { cost_percent: "0.30" })],
            pendingCustomerIds: new Set(),
            alwaysAlignFields: [],
        });
        // Customer 1 diverges on max_payment_term (120 vs 180) but that field
        // did not change on the policy, so only cost_percent counts.
        expect(plan.fieldsToPush).toEqual(["cost_percent"]);
        expect(plan.customerCountByField).toEqual({ cost_percent: 1 });
        expect(plan.rowsToVersion.map((r) => r.customer_id)).toEqual([1]);
        expect(plan.uniqueCustomerCount).toBe(1);
    });

    it("realigns registration_fee_percent when customers diverge even if policy unchanged", () => {
        const plan = planPolicyPushToCustomers({
            policyBefore: {
                ...policyBefore,
                registration_fee_percent: 30,
            },
            policyAfter: {
                ...policyBefore,
                registration_fee_percent: 30,
            },
            activeRows: [
                row(1, { registration_fee_percent: null }),
                row(2, { registration_fee_percent: 30 }),
            ],
            pendingCustomerIds: new Set(),
        });
        expect(plan.fieldsToPush).toEqual(["registration_fee_percent"]);
        expect(plan.customerCountByField).toEqual({
            registration_fee_percent: 1,
        });
        expect(plan.rowsToVersion.map((r) => r.customer_id)).toEqual([1]);
        expect(plan.uniqueCustomerCount).toBe(1);
    });

    it("counts per field and unique customers across multiple changed fields", () => {
        const plan = planPolicyPushToCustomers({
            policyBefore,
            policyAfter: {
                ...policyBefore,
                cost_percent: "0.4",
                reporting_days: 45,
            },
            activeRows: [
                row(1),
                row(2, { reporting_days: 45 }),
                row(3, { cost_percent: "0.4", reporting_days: 45 }),
            ],
            pendingCustomerIds: new Set(),
            alwaysAlignFields: [],
        });
        expect(plan.fieldsToPush).toEqual(["reporting_days", "cost_percent"]);
        expect(plan.customerCountByField).toEqual({
            reporting_days: 1,
            cost_percent: 2,
        });
        expect(plan.uniqueCustomerCount).toBe(2);
    });

    it("skips customers with a pending Customer Policy and counts them", () => {
        const plan = planPolicyPushToCustomers({
            policyBefore,
            policyAfter: { ...policyBefore, cost_percent: "0.5" },
            activeRows: [row(1), row(2), row(3, { cost_percent: "0.5" })],
            pendingCustomerIds: new Set([2, 3]),
            alwaysAlignFields: [],
        });
        expect(plan.rowsToVersion.map((r) => r.customer_id)).toEqual([1]);
        expect(plan.customerCountByField).toEqual({ cost_percent: 1 });
        expect(plan.uniqueCustomerCount).toBe(1);
        // Customer 3 already matches, so it would not version either way.
        expect(plan.skippedPendingCustomerCount).toBe(1);
    });
});
