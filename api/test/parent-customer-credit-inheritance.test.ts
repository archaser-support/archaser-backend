import {
    listDescendantCustomerIds,
    onParentCustomerIdChanged,
    remirrorDescendantsFromRoot,
    resolveCustomerCreditPoolRoot,
} from "@archaser/credit-insurance-domain";

type CustomerRow = {
    id: number;
    account_id: number;
    parent_customer_id: number | null;
};

type PolicyRow = {
    id: number;
    customer_id: number;
    insurance_policy_id: number | null;
    customer_number_policy: string | null;
    approved_limit: number | null;
    approved_limit_currency: string | null;
    approved_limit_expiration_date: Date | null;
    zero_limit_date: Date | null;
    limit_type: string | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
    mep_cutoff_day: number | null;
    mep_substitute_extra_days: number | null;
    reporting_cutoff_day: number | null;
    reporting_substitute_extra_days: number | null;
    payment_term_cutoff_day: number | null;
    payment_term_substitute_day: number | null;
    excluded_from_policy: boolean;
    policy_exclusion_reason: string | null;
    credit_score: number | null;
    credit_score_input_date: Date | null;
    active_customer_since: Date | null;
    outdated_dcl: boolean;
    cost_percent: number | null;
    registration_fee_percent: number | null;
    policy_change_start_date: Date;
    policy_change_end_date: Date | null;
    status: "active" | "pending" | "inactive";
    is_active: boolean;
    capacity_gap_amount: number | null;
    capacity_gap_amount_date: Date | null;
    retained_capacity_gap: number | null;
    uninsured_amount: number | null;
    capacity_gap_amount1: number | null;
    capacity_gap_currency1: string | null;
    capacity_gap_amount2: number | null;
    capacity_gap_currency2: string | null;
    uninsured_amount1: number | null;
    uninsured_currency1: string | null;
    uninsured_amount2: number | null;
    uninsured_currency2: string | null;
    created_by: string | null;
    modified_by: string | null;
};

function emptyPolicy(
    overrides: Partial<PolicyRow> &
        Pick<PolicyRow, "id" | "customer_id" | "status" | "is_active">
): PolicyRow {
    return {
        insurance_policy_id: null,
        customer_number_policy: null,
        approved_limit: null,
        approved_limit_currency: null,
        approved_limit_expiration_date: null,
        zero_limit_date: null,
        limit_type: null,
        max_payment_term: null,
        max_allowed_mep: null,
        reporting_days: null,
        mep_cutoff_day: null,
        mep_substitute_extra_days: null,
        reporting_cutoff_day: null,
        reporting_substitute_extra_days: null,
        payment_term_cutoff_day: null,
        payment_term_substitute_day: null,
        excluded_from_policy: false,
        policy_exclusion_reason: null,
        credit_score: null,
        credit_score_input_date: null,
        active_customer_since: null,
        outdated_dcl: false,
        cost_percent: null,
        registration_fee_percent: null,
        policy_change_start_date: new Date("2026-01-01"),
        policy_change_end_date: null,
        capacity_gap_amount: null,
        capacity_gap_amount_date: null,
        retained_capacity_gap: null,
        uninsured_amount: null,
        capacity_gap_amount1: null,
        capacity_gap_currency1: null,
        capacity_gap_amount2: null,
        capacity_gap_currency2: null,
        uninsured_amount1: null,
        uninsured_currency1: null,
        uninsured_amount2: null,
        uninsured_currency2: null,
        created_by: null,
        modified_by: null,
        ...overrides,
    };
}

function createMemoryDb(args: {
    customers: CustomerRow[];
    policies: PolicyRow[];
    hasCreditInsurance?: boolean;
}) {
    const customers = [...args.customers];
    const policies = [...args.policies];
    let nextPolicyId =
        policies.reduce((max, row) => Math.max(max, row.id), 0) + 1;
    const hasCreditInsurance = args.hasCreditInsurance !== false;

    const db = {
        account: {
            findUnique: jest.fn(async ({ where }: { where: { id: number } }) => ({
                has_credit_insurance: hasCreditInsurance,
            })),
        },
        customer: {
            findUnique: jest.fn(
                async ({
                    where,
                    select,
                }: {
                    where: { id: number };
                    select?: Record<string, boolean>;
                }) => {
                    const row = customers.find((c) => c.id === where.id);
                    if (!row) {
                        return null;
                    }
                    if (!select) {
                        return row;
                    }
                    const out: Record<string, unknown> = {};
                    for (const key of Object.keys(select)) {
                        out[key] = (row as Record<string, unknown>)[key];
                    }
                    return out;
                }
            ),
            findMany: jest.fn(
                async ({
                    where,
                }: {
                    where: {
                        account_id: number;
                        parent_customer_id: { in: number[] };
                    };
                }) =>
                    customers
                        .filter(
                            (c) =>
                                c.account_id === where.account_id &&
                                c.parent_customer_id != null &&
                                where.parent_customer_id.in.includes(
                                    c.parent_customer_id
                                )
                        )
                        .map((c) => ({ id: c.id }))
            ),
        },
        customerPolicy: {
            findMany: jest.fn(
                async ({
                    where,
                }: {
                    where: {
                        customer_id: number;
                        OR: Array<
                            | { is_active: boolean }
                            | { status: string }
                        >;
                    };
                }) =>
                    policies.filter((p) => {
                        if (p.customer_id !== where.customer_id) {
                            return false;
                        }
                        return p.is_active || p.status === "pending";
                    })
            ),
            updateMany: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: {
                        customer_id: number;
                        OR: Array<
                            | { is_active: boolean }
                            | { status: string }
                        >;
                    };
                    data: Partial<PolicyRow>;
                }) => {
                    let count = 0;
                    for (const row of policies) {
                        if (row.customer_id !== where.customer_id) {
                            continue;
                        }
                        if (!(row.is_active || row.status === "pending")) {
                            continue;
                        }
                        Object.assign(row, data);
                        count += 1;
                    }
                    return { count };
                }
            ),
            create: jest.fn(
                async ({
                    data,
                }: {
                    data: Partial<PolicyRow> & { customer_id: number };
                }) => {
                    const row = emptyPolicy({
                        id: nextPolicyId++,
                        customer_id: data.customer_id,
                        status: (data.status as PolicyRow["status"]) ?? "inactive",
                        is_active: data.is_active === true,
                        ...data,
                    });
                    policies.push(row);
                    return row;
                }
            ),
        },
        // syncCustomerInsuranceFields pulls these; keep stubs quiet for unit tests
        invoice: {
            findMany: jest.fn(async () => []),
        },
        customerTopUp: {
            findMany: jest.fn(async () => []),
        },
        __customers: customers,
        __policies: policies,
        setParent(customerId: number, parentId: number | null) {
            const row = customers.find((c) => c.id === customerId);
            if (row) {
                row.parent_customer_id = parentId;
            }
        },
    };

    return db;
}

describe("parent customer credit inheritance", () => {
    it("resolves the credit pool root by walking parents", async () => {
        const db = createMemoryDb({
            customers: [
                { id: 1, account_id: 9, parent_customer_id: null },
                { id: 2, account_id: 9, parent_customer_id: 1 },
                { id: 3, account_id: 9, parent_customer_id: 2 },
            ],
            policies: [],
        });

        await expect(
            resolveCustomerCreditPoolRoot(3, db as never)
        ).resolves.toBe(1);
        await expect(
            listDescendantCustomerIds(1, 9, db as never)
        ).resolves.toEqual([2, 3]);
    });

    it("empty root clears descendant live mirrors", async () => {
        const db = createMemoryDb({
            customers: [
                { id: 1, account_id: 9, parent_customer_id: null },
                { id: 2, account_id: 9, parent_customer_id: 1 },
            ],
            policies: [
                emptyPolicy({
                    id: 20,
                    customer_id: 2,
                    status: "active",
                    is_active: true,
                    insurance_policy_id: 200,
                    approved_limit: 1000,
                    limit_type: "Named",
                }),
            ],
        });

        await remirrorDescendantsFromRoot(1, 9, {
            dbClient: db as never,
            skipInsuranceSync: true,
        });

        const childLive = db.__policies.filter(
            (p) =>
                p.customer_id === 2 &&
                (p.is_active || p.status === "pending")
        );
        expect(childLive).toHaveLength(0);
    });

    it("root policy remirror updates nested descendants", async () => {
        const db = createMemoryDb({
            customers: [
                { id: 1, account_id: 9, parent_customer_id: null },
                { id: 2, account_id: 9, parent_customer_id: 1 },
                { id: 3, account_id: 9, parent_customer_id: 2 },
            ],
            policies: [
                emptyPolicy({
                    id: 10,
                    customer_id: 1,
                    status: "active",
                    is_active: true,
                    insurance_policy_id: 100,
                    customer_number_policy: "ACME",
                    approved_limit: 9000,
                    limit_type: "Named",
                }),
            ],
        });

        await remirrorDescendantsFromRoot(1, 9, {
            dbClient: db as never,
            skipInsuranceSync: true,
        });

        for (const id of [2, 3]) {
            const active = db.__policies.find(
                (p) => p.customer_id === id && p.is_active
            );
            expect(active?.approved_limit).toBe(9000);
            expect(active?.customer_number_policy).toBe("ACME");
        }
    });

    it("skips credit side effects when the account has no credit insurance", async () => {
        const db = createMemoryDb({
            hasCreditInsurance: false,
            customers: [
                { id: 1, account_id: 9, parent_customer_id: null },
                { id: 2, account_id: 9, parent_customer_id: null },
            ],
            policies: [
                emptyPolicy({
                    id: 10,
                    customer_id: 1,
                    status: "active",
                    is_active: true,
                    approved_limit: 50000,
                    limit_type: "Named",
                }),
                emptyPolicy({
                    id: 20,
                    customer_id: 2,
                    status: "active",
                    is_active: true,
                    approved_limit: 1,
                    limit_type: "DCL",
                }),
            ],
        });

        db.setParent(2, 1);
        await onParentCustomerIdChanged({
            accountId: 9,
            customerId: 2,
            previousParentId: null,
            nextParentId: 1,
            dbClient: db as never,
            skipInsuranceSync: true,
        });

        expect(
            db.__policies.find((p) => p.id === 20)?.approved_limit
        ).toBe(1);
        expect(db.customerPolicy.create).not.toHaveBeenCalled();
    });
});
