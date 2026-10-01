import { Prisma } from "@prisma/client";
import {
    allocateLiveCapacityGapWaterfall,
    compareInvoicesForLiveCapacityGapWaterfall,
    resolveCreditPoolMemberIds,
    syncCreditInsuranceGapPipelineForCustomer,
    syncCustomerPolicyGapAmountsForCustomer,
    syncInvoiceCapacityGapAmountsForCustomer,
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
    approved_limit: number | null;
    approved_limit_currency: string | null;
    approved_limit_expiration_date: Date | null;
    limit_type: string | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
    excluded_from_policy: boolean;
    policy_exclusion_reason: string | null;
    credit_score: number | null;
    credit_score_input_date: Date | null;
    active_customer_since: Date | null;
    outdated_dcl: boolean;
    customer_number_policy: string | null;
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
};

type InvoiceRow = {
    id: number;
    customer_id: number;
    account_id: number;
    status: "Due" | "Overdue" | "Paid";
    policy_id: number | null;
    invoice_date: Date | null;
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    amount: number | null;
    amount_without_vat: number | null;
    customer_currency: string | null;
    limit_assessed_amount: Prisma.Decimal | null;
    limit_assessed_currency: string | null;
    capacity_gap_amount: Prisma.Decimal | null;
    capacity_gap_amount_limit: Prisma.Decimal | null;
    capacity_gap_amount_date: Date | null;
    in_capacity_gap: boolean;
};

function emptyPolicy(
    overrides: Partial<PolicyRow> &
        Pick<PolicyRow, "id" | "customer_id" | "insurance_policy_id" | "approved_limit">
): PolicyRow {
    return {
        approved_limit_currency: "USD",
        approved_limit_expiration_date: null,
        limit_type: null,
        max_payment_term: null,
        max_allowed_mep: null,
        reporting_days: null,
        excluded_from_policy: false,
        policy_exclusion_reason: null,
        credit_score: null,
        credit_score_input_date: null,
        active_customer_since: null,
        outdated_dcl: false,
        customer_number_policy: "P-1",
        is_active: true,
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
        ...overrides,
    };
}

function createMemoryDb(args: {
    customers: CustomerRow[];
    policies: PolicyRow[];
    invoices: InvoiceRow[];
    topUps?: Array<{
        customer_id: number;
        cancelled_at: Date | null;
        start_date: Date;
        end_date: Date;
        top_up_value: number;
        currency: string;
    }>;
}) {
    const customers = [...args.customers];
    const policies = [...args.policies];
    const invoices = [...args.invoices];
    const topUps = [...(args.topUps ?? [])];

    const matchesCustomerIdFilter = (
        customerId: number,
        filter: number | { in: number[] } | undefined
    ): boolean => {
        if (filter == null) {
            return true;
        }
        if (typeof filter === "number") {
            return customerId === filter;
        }
        return filter.in.includes(customerId);
    };

    const db = {
        account: {
            findUnique: jest.fn(async () => ({
                has_credit_insurance: true,
                currency: "USD",
                amounts_include_vat: true,
            })),
        },
        customer: {
            findUnique: jest.fn(
                async ({
                    where,
                    select,
                }: {
                    where: { id: number };
                    select?: Record<string, unknown>;
                }) => {
                    const row = customers.find((c) => c.id === where.id);
                    if (!row) {
                        return null;
                    }
                    const out: Record<string, unknown> = {
                        id: row.id,
                        account_id: row.account_id,
                        parent_customer_id: row.parent_customer_id,
                        Account: {
                            currency: "USD",
                            has_credit_insurance: true,
                            amounts_include_vat: true,
                        },
                    };
                    if (select?.CustomerPolicy) {
                        const whereClause = (
                            select.CustomerPolicy as {
                                where?: { is_active?: boolean; id?: number };
                            }
                        ).where;
                        out.CustomerPolicy = policies.filter((p) => {
                            if (p.customer_id !== row.id) {
                                return false;
                            }
                            if (whereClause?.id != null) {
                                return p.id === whereClause.id;
                            }
                            if (whereClause?.is_active === true) {
                                return p.is_active;
                            }
                            return true;
                        });
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
            findFirst: jest.fn(
                async ({
                    where,
                }: {
                    where: { customer_id: number; is_active: boolean };
                }) =>
                    policies.find(
                        (p) =>
                            p.customer_id === where.customer_id &&
                            p.is_active === where.is_active
                    ) ?? null
            ),
            update: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: { id: number };
                    data: Partial<PolicyRow>;
                }) => {
                    const row = policies.find((p) => p.id === where.id);
                    if (!row) {
                        throw new Error(`policy ${where.id} missing`);
                    }
                    Object.assign(row, data);
                    return row;
                }
            ),
        },
        customerTopUp: {
            findMany: jest.fn(
                async ({
                    where,
                }: {
                    where: {
                        customer_id: number;
                        cancelled_at: null;
                        start_date: { lte: Date };
                        end_date: { gte: Date };
                    };
                }) =>
                    topUps
                        .filter(
                            (t) =>
                                t.customer_id === where.customer_id &&
                                t.cancelled_at == null &&
                                t.start_date <= where.start_date.lte &&
                                t.end_date >= where.end_date.gte
                        )
                        .map((t, idx) => ({
                            id: 700 + idx,
                            top_up_type: "Fixed" as const,
                            top_up_value: t.top_up_value,
                            currency: t.currency,
                            start_date: t.start_date,
                            end_date: t.end_date,
                            cancelled_at: t.cancelled_at,
                            InsurancePolicy: {
                                id: 900 + idx,
                                allow_concurrent_top_ups: false,
                                parent_insurance_policy_id: 50,
                            },
                        }))
            ),
        },
        invoice: {
            findMany: jest.fn(
                async ({
                    where,
                }: {
                    where: {
                        customer_id?: number | { in: number[] };
                        account_id?: number;
                        status?: { in: string[] };
                        policy_id?: number;
                    };
                }) => {
                    return invoices.filter((inv) => {
                        if (
                            where.customer_id != null &&
                            !matchesCustomerIdFilter(
                                inv.customer_id,
                                where.customer_id
                            )
                        ) {
                            return false;
                        }
                        if (
                            where.account_id != null &&
                            inv.account_id !== where.account_id
                        ) {
                            return false;
                        }
                        if (
                            where.status?.in != null &&
                            !where.status.in.includes(inv.status)
                        ) {
                            return false;
                        }
                        if (
                            where.policy_id != null &&
                            inv.policy_id !== where.policy_id
                        ) {
                            return false;
                        }
                        return true;
                    });
                }
            ),
            updateMany: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: { id: { in: number[] } };
                    data: Partial<InvoiceRow>;
                }) => {
                    let count = 0;
                    for (const inv of invoices) {
                        if (!where.id.in.includes(inv.id)) {
                            continue;
                        }
                        Object.assign(inv, data);
                        if (data.capacity_gap_amount != null) {
                            inv.capacity_gap_amount = new Prisma.Decimal(
                                Number(data.capacity_gap_amount)
                            );
                        }
                        if (data.capacity_gap_amount_limit != null) {
                            inv.capacity_gap_amount_limit = new Prisma.Decimal(
                                Number(data.capacity_gap_amount_limit)
                            );
                        }
                        count += 1;
                    }
                    return { count };
                }
            ),
            update: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: { id: number };
                    data: Partial<InvoiceRow>;
                }) => {
                    const inv = invoices.find((i) => i.id === where.id);
                    if (!inv) {
                        throw new Error(`invoice ${where.id} missing`);
                    }
                    Object.assign(inv, data);
                    return inv;
                }
            ),
        },
        currencyRate: {
            findMany: jest.fn(async () => []),
        },
        $queryRaw: jest.fn(async () => {
            const open = invoices.filter(
                (inv) => inv.status === "Due" || inv.status === "Overdue"
            );
            const ar = open.reduce(
                (sum, inv) => sum + Number(inv.outstanding_debt ?? 0),
                0
            );
            return [
                {
                    ar,
                    customer_currency: "USD",
                    outstanding_debt: ar,
                    customer_outstanding_debt: ar,
                },
            ];
        }),
        $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            // bulkUpdateInvoiceCapacityGaps template values:
            // assessedAt, ids, assessedAmounts, assessedCurrencies, gapBases, gapLimits, gapDates
            if (
                Array.isArray(values[1]) &&
                Array.isArray(values[2]) &&
                Array.isArray(values[4]) &&
                Array.isArray(values[5])
            ) {
                const ids = values[1] as number[];
                const assessedAmounts = values[2] as number[];
                const assessedCurrencies = values[3] as string[];
                const gapBases = values[4] as Array<number | null>;
                const gapLimits = values[5] as number[];
                for (let i = 0; i < ids.length; i += 1) {
                    const inv = invoices.find((row) => row.id === ids[i]);
                    if (!inv) {
                        continue;
                    }
                    inv.limit_assessed_amount = new Prisma.Decimal(
                        assessedAmounts[i] ?? 0
                    );
                    inv.limit_assessed_currency = assessedCurrencies[i] ?? null;
                    inv.capacity_gap_amount =
                        gapBases[i] == null
                            ? null
                            : new Prisma.Decimal(gapBases[i] as number);
                    inv.capacity_gap_amount_limit = new Prisma.Decimal(
                        gapLimits[i] ?? 0
                    );
                }
            }
            void strings;
            return idsLengthSafe(values);
        }),
    };

    return { db, customers, policies, invoices };
}

function idsLengthSafe(values: unknown[]): number {
    if (Array.isArray(values[1])) {
        return (values[1] as unknown[]).length;
    }
    return 0;
}

describe("parent customer group capacity gap + invoice waterfall", () => {
    it("allocates one oldest-first waterfall across combined group invoices", () => {
        const open = [
            {
                id: 2,
                invoice_date: new Date("2026-02-01"),
                outstandingInLimitCurrency: 50_000,
            },
            {
                id: 1,
                invoice_date: new Date("2026-01-01"),
                outstandingInLimitCurrency: 60_000,
            },
            {
                id: 3,
                invoice_date: new Date("2026-03-01"),
                outstandingInLimitCurrency: 40_000,
            },
        ]
            .slice()
            .sort(compareInvoicesForLiveCapacityGapWaterfall);

        const allocations = allocateLiveCapacityGapWaterfall({
            effectiveLimit: 100_000,
            openInvoices: open,
        });

        // Oldest 60k fully covered; next 50k covered 40k → gap 10k; newest fully in gap.
        expect(allocations).toEqual([
            {
                id: 1,
                limitAssessedAmount: 60_000,
                capacityGapAmountLimit: 0,
            },
            {
                id: 2,
                limitAssessedAmount: 40_000,
                capacityGapAmountLimit: 10_000,
            },
            {
                id: 3,
                limitAssessedAmount: 0,
                capacityGapAmountLimit: 40_000,
            },
        ]);
        expect(
            allocations.reduce((s, a) => s + a.capacityGapAmountLimit, 0)
        ).toBe(50_000);
    });

    it("persists shared capacity gap on root only (linked children store 0)", async () => {
        // Root limit 100k; parent AR 0; child A 60k; child B 50k → group gap 10k on root.
        const { db, policies } = createMemoryDb({
            customers: [
                { id: 1, account_id: 10, parent_customer_id: null },
                { id: 2, account_id: 10, parent_customer_id: 1 },
                { id: 3, account_id: 10, parent_customer_id: 1 },
            ],
            policies: [
                emptyPolicy({
                    id: 11,
                    customer_id: 1,
                    insurance_policy_id: 50,
                    approved_limit: 100_000,
                }),
                emptyPolicy({
                    id: 12,
                    customer_id: 2,
                    insurance_policy_id: 50,
                    approved_limit: 100_000,
                }),
                emptyPolicy({
                    id: 13,
                    customer_id: 3,
                    insurance_policy_id: 50,
                    approved_limit: 100_000,
                }),
            ],
            invoices: [
                {
                    id: 101,
                    customer_id: 2,
                    account_id: 10,
                    status: "Due",
                    policy_id: 50,
                    invoice_date: new Date("2026-01-01"),
                    outstanding_debt: 60_000,
                    customer_outstanding_debt: 60_000,
                    amount: 60_000,
                    amount_without_vat: 60_000,
                    customer_currency: "USD",
                    limit_assessed_amount: null,
                    limit_assessed_currency: null,
                    capacity_gap_amount: null,
                    capacity_gap_amount_limit: null,
                    capacity_gap_amount_date: null,
                    in_capacity_gap: false,
                },
                {
                    id: 102,
                    customer_id: 3,
                    account_id: 10,
                    status: "Due",
                    policy_id: 50,
                    invoice_date: new Date("2026-02-01"),
                    outstanding_debt: 50_000,
                    customer_outstanding_debt: 50_000,
                    amount: 50_000,
                    amount_without_vat: 50_000,
                    customer_currency: "USD",
                    limit_assessed_amount: null,
                    limit_assessed_currency: null,
                    capacity_gap_amount: null,
                    capacity_gap_amount_limit: null,
                    capacity_gap_amount_date: null,
                    in_capacity_gap: false,
                },
            ],
        });

        const pool = await resolveCreditPoolMemberIds(2, 10, db as never);
        expect(pool).toEqual({
            rootCustomerId: 1,
            memberIds: [1, 2, 3],
        });

        await syncCustomerPolicyGapAmountsForCustomer(2, {
            dbClient: db as never,
            openAr: 110_000,
            skipInvoiceFlags: true,
            poolMemberIds: pool.memberIds,
            poolRootCustomerId: pool.rootCustomerId,
        });

        expect(policies.map((p) => p.capacity_gap_amount)).toEqual([
            10_000,
            null,
            null,
        ]);
    });

    it("runs one combined invoice waterfall against the shared root limit", async () => {
        const { db, invoices } = createMemoryDb({
            customers: [
                { id: 1, account_id: 10, parent_customer_id: null },
                { id: 2, account_id: 10, parent_customer_id: 1 },
                { id: 3, account_id: 10, parent_customer_id: 1 },
            ],
            policies: [
                emptyPolicy({
                    id: 11,
                    customer_id: 1,
                    insurance_policy_id: 50,
                    approved_limit: 100_000,
                }),
                emptyPolicy({
                    id: 12,
                    customer_id: 2,
                    insurance_policy_id: 50,
                    approved_limit: 100_000,
                }),
                emptyPolicy({
                    id: 13,
                    customer_id: 3,
                    insurance_policy_id: 50,
                    approved_limit: 100_000,
                }),
            ],
            invoices: [
                {
                    id: 201,
                    customer_id: 2,
                    account_id: 10,
                    status: "Due",
                    policy_id: 50,
                    invoice_date: new Date("2026-01-15"),
                    outstanding_debt: 60_000,
                    customer_outstanding_debt: 60_000,
                    amount: 60_000,
                    amount_without_vat: 60_000,
                    customer_currency: "USD",
                    limit_assessed_amount: null,
                    limit_assessed_currency: null,
                    capacity_gap_amount: null,
                    capacity_gap_amount_limit: null,
                    capacity_gap_amount_date: null,
                    in_capacity_gap: false,
                },
                {
                    id: 202,
                    customer_id: 3,
                    account_id: 10,
                    status: "Due",
                    policy_id: 50,
                    invoice_date: new Date("2026-02-15"),
                    outstanding_debt: 50_000,
                    customer_outstanding_debt: 50_000,
                    amount: 50_000,
                    amount_without_vat: 50_000,
                    customer_currency: "USD",
                    limit_assessed_amount: null,
                    limit_assessed_currency: null,
                    capacity_gap_amount: null,
                    capacity_gap_amount_limit: null,
                    capacity_gap_amount_date: null,
                    in_capacity_gap: false,
                },
            ],
        });

        await syncInvoiceCapacityGapAmountsForCustomer(3, {
            dbClient: db as never,
        });

        const byId = Object.fromEntries(
            invoices.map((inv) => [
                inv.id,
                {
                    assessed: Number(inv.limit_assessed_amount ?? 0),
                    gap: Number(inv.capacity_gap_amount_limit ?? 0),
                },
            ])
        );
        // Waterfall order is group-wide; gap amounts persist only on root invoices
        // (both open invoices here belong to children → gaps forced to 0).
        expect(byId[201]).toEqual({ assessed: 60_000, gap: 0 });
        expect(byId[202]).toEqual({ assessed: 40_000, gap: 0 });
    });

    it("includes root top-ups in the shared limit and ignores child top-ups", async () => {
        const { db, invoices } = createMemoryDb({
            customers: [
                { id: 1, account_id: 10, parent_customer_id: null },
                { id: 2, account_id: 10, parent_customer_id: 1 },
            ],
            policies: [
                emptyPolicy({
                    id: 11,
                    customer_id: 1,
                    insurance_policy_id: 50,
                    approved_limit: 100_000,
                }),
                emptyPolicy({
                    id: 12,
                    customer_id: 2,
                    insurance_policy_id: 50,
                    approved_limit: 100_000,
                }),
            ],
            invoices: [
                {
                    id: 301,
                    customer_id: 2,
                    account_id: 10,
                    status: "Due",
                    policy_id: 50,
                    invoice_date: new Date("2026-01-01"),
                    outstanding_debt: 110_000,
                    customer_outstanding_debt: 110_000,
                    amount: 110_000,
                    amount_without_vat: 110_000,
                    customer_currency: "USD",
                    limit_assessed_amount: null,
                    limit_assessed_currency: null,
                    capacity_gap_amount: null,
                    capacity_gap_amount_limit: null,
                    capacity_gap_amount_date: null,
                    in_capacity_gap: false,
                },
            ],
            topUps: [
                {
                    customer_id: 1,
                    cancelled_at: null,
                    start_date: new Date("2020-01-01"),
                    end_date: new Date("2099-01-01"),
                    top_up_value: 20_000,
                    currency: "USD",
                },
                {
                    customer_id: 2,
                    cancelled_at: null,
                    start_date: new Date("2020-01-01"),
                    end_date: new Date("2099-01-01"),
                    top_up_value: 50_000,
                    currency: "USD",
                },
            ],
        });

        await syncInvoiceCapacityGapAmountsForCustomer(2, {
            dbClient: db as never,
        });

        // Shared limit = 100k + root top-up 20k = 120k → child AR 110k fully covered.
        expect(Number(invoices[0].limit_assessed_amount ?? 0)).toBe(110_000);
        expect(Number(invoices[0].capacity_gap_amount_limit ?? 0)).toBe(0);
    });

    it("recalculates solo pool after disconnect without leftover group gap", async () => {
        const { db, policies, customers } = createMemoryDb({
            customers: [
                { id: 1, account_id: 10, parent_customer_id: null },
                { id: 2, account_id: 10, parent_customer_id: 1 },
            ],
            policies: [
                emptyPolicy({
                    id: 11,
                    customer_id: 1,
                    insurance_policy_id: 50,
                    approved_limit: 100_000,
                    capacity_gap_amount: 10_000,
                }),
                emptyPolicy({
                    id: 12,
                    customer_id: 2,
                    insurance_policy_id: 50,
                    approved_limit: 100_000,
                    capacity_gap_amount: 10_000,
                }),
            ],
            invoices: [
                {
                    id: 401,
                    customer_id: 2,
                    account_id: 10,
                    status: "Due",
                    policy_id: 50,
                    invoice_date: new Date("2026-01-01"),
                    outstanding_debt: 60_000,
                    customer_outstanding_debt: 60_000,
                    amount: 60_000,
                    amount_without_vat: 60_000,
                    customer_currency: "USD",
                    limit_assessed_amount: null,
                    limit_assessed_currency: null,
                    capacity_gap_amount: null,
                    capacity_gap_amount_limit: null,
                    capacity_gap_amount_date: null,
                    in_capacity_gap: false,
                },
            ],
        });

        // Disconnect child 2.
        customers[1].parent_customer_id = null;

        await syncCreditInsuranceGapPipelineForCustomer(2, {
            dbClient: db as never,
            skipFlags: true,
        });

        // Solo: AR 60k vs own limit 100k → gap 0 (no leftover group 10k).
        expect(policies.find((p) => p.customer_id === 2)?.capacity_gap_amount).toBe(
            0
        );
    });
});
