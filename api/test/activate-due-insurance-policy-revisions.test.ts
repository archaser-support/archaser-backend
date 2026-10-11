jest.mock("../../packages/credit-insurance-domain/src/credit-insurance/domain/asOfRewriteQueue", () => ({
    ...jest.requireActual(
        "../../packages/credit-insurance-domain/src/credit-insurance/domain/asOfRewriteQueue"
    ),
    enqueueAsOfRewrite: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../packages/credit-insurance-domain/src/credit-insurance/domain/syncCustomerInsuranceFields", () => ({
    ...jest.requireActual(
        "../../packages/credit-insurance-domain/src/credit-insurance/domain/syncCustomerInsuranceFields"
    ),
    syncCustomerInsuranceFields: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../packages/credit-insurance-domain/src/credit-insurance/domain/syncCreditInsuranceGapPipeline", () => ({
    ...jest.requireActual(
        "../../packages/credit-insurance-domain/src/credit-insurance/domain/syncCreditInsuranceGapPipeline"
    ),
    ensureCustomerCapacityGapStored: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../packages/credit-insurance-domain/src/credit-insurance/domain/syncCustomerPolicyGapAmounts", () => ({
    ...jest.requireActual(
        "../../packages/credit-insurance-domain/src/credit-insurance/domain/syncCustomerPolicyGapAmounts"
    ),
    freezeCustomerPolicyGapOnDeactivation: jest
        .fn()
        .mockResolvedValue(undefined),
}));

import { Prisma } from "@prisma/client";
import {
    activateDueInsurancePolicyRevisions,
    buildCustomerPolicyVersionFromPolicyPush,
    enqueueAsOfRewrite,
} from "@archaser/credit-insurance-domain";

function utcDay(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

const TODAY = utcDay("2026-10-07");

type PolicyRow = {
    id: number;
    account_id: number;
    policy_kind: "Primary" | "TopUp";
    start_date: Date;
    max_payment_term: number;
    cost_percent: string;
    reporting_days: number;
    insurer_name: string;
    modified_by: string | null;
    pending_effective_date: Date | null;
    pending_payload: unknown;
    pending_created_at: Date | null;
    pending_created_by: string | null;
};

type CustomerPolicyRow = {
    id: number;
    customer_id: number;
    account_id: number;
    insurance_policy_id: number | null;
    is_active: boolean;
    status: "active" | "pending" | "inactive";
    policy_change_start_date: Date;
    max_payment_term: number;
    cost_percent: string;
    reporting_days: number;
    modified_by?: string | null;
};

function policy(overrides: Partial<PolicyRow> & { id: number }): PolicyRow {
    return {
        account_id: 1,
        policy_kind: "Primary",
        start_date: utcDay("2026-01-01"),
        max_payment_term: 180,
        cost_percent: "0.25",
        reporting_days: 30,
        insurer_name: "Insurer",
        modified_by: null,
        pending_effective_date: null,
        pending_payload: null,
        pending_created_at: null,
        pending_created_by: null,
        ...overrides,
    };
}

function customerPolicy(
    overrides: Partial<CustomerPolicyRow> & { id: number; customer_id: number }
): CustomerPolicyRow {
    return {
        account_id: 1,
        insurance_policy_id: 10,
        is_active: true,
        status: "active",
        policy_change_start_date: utcDay("2026-03-01"),
        max_payment_term: 120,
        cost_percent: "0.25",
        reporting_days: 30,
        ...overrides,
    };
}

/** In-memory Prisma stand-in whose $transaction rolls back on throw. */
function createMemoryDb(state: {
    policies: PolicyRow[];
    customerPolicies: CustomerPolicyRow[];
}) {
    let nextCustomerPolicyId = 1000;
    const failCreateForPolicyIds = new Set<number>();

    const db = {
        failCreateForPolicyIds,
        insurancePolicy: {
            findMany: jest.fn(
                async ({
                    where,
                }: {
                    where: { pending_effective_date: { lte: Date } };
                }) =>
                    state.policies
                        .filter(
                            (row) =>
                                row.pending_effective_date != null &&
                                row.pending_effective_date <=
                                    where.pending_effective_date.lte
                        )
                        .map((row) => ({
                            id: row.id,
                            account_id: row.account_id,
                        }))
            ),
            findFirst: jest.fn(
                async ({
                    where,
                }: {
                    where: {
                        id: number;
                        pending_effective_date: { lte: Date };
                    };
                }) => {
                    const row = state.policies.find((p) => p.id === where.id);
                    if (
                        !row ||
                        row.pending_effective_date == null ||
                        row.pending_effective_date >
                            where.pending_effective_date.lte
                    ) {
                        return null;
                    }
                    return { ...row };
                }
            ),
            update: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: { id: number };
                    data: Record<string, unknown>;
                }) => {
                    const row = state.policies.find((p) => p.id === where.id)!;
                    for (const [key, value] of Object.entries(data)) {
                        (row as Record<string, unknown>)[key] =
                            value === Prisma.DbNull ? null : value;
                    }
                    return { ...row };
                }
            ),
        },
        customerPolicy: {
            findMany: jest.fn(
                async ({
                    where,
                }: {
                    where: {
                        status?: string;
                        customer_id?: { in: number[] };
                        insurance_policy_id?: number;
                        Customer?: { account_id: number };
                    };
                }) => {
                    if (where.status === "pending") {
                        return state.customerPolicies
                            .filter(
                                (row) =>
                                    row.status === "pending" &&
                                    where.customer_id!.in.includes(
                                        row.customer_id
                                    )
                            )
                            .map((row) => ({ customer_id: row.customer_id }));
                    }
                    return state.customerPolicies
                        .filter(
                            (row) =>
                                row.insurance_policy_id ===
                                    where.insurance_policy_id &&
                                row.is_active &&
                                row.account_id === where.Customer!.account_id
                        )
                        .map((row) => ({ ...row }));
                }
            ),
            update: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: { id: number };
                    data: Record<string, unknown>;
                }) => {
                    const row = state.customerPolicies.find(
                        (r) => r.id === where.id
                    )!;
                    Object.assign(row, data);
                    return { ...row };
                }
            ),
            create: jest.fn(
                async ({ data }: { data: Record<string, unknown> }) => {
                    if (
                        failCreateForPolicyIds.has(
                            data.insurance_policy_id as number
                        )
                    ) {
                        throw new Error("customer policy insert failed");
                    }
                    const previous = state.customerPolicies.find(
                        (r) => r.customer_id === data.customer_id
                    )!;
                    const row = {
                        ...(data as unknown as CustomerPolicyRow),
                        id: nextCustomerPolicyId++,
                        account_id: previous.account_id,
                    };
                    state.customerPolicies.push(row);
                    return { ...row };
                }
            ),
        },
        $transaction: jest.fn(
            async (run: (tx: unknown) => Promise<unknown>) => {
                const policiesSnapshot = state.policies.map((r) => ({ ...r }));
                const customerPoliciesSnapshot = state.customerPolicies.map(
                    (r) => ({ ...r })
                );
                try {
                    return await run(db);
                } catch (error) {
                    state.policies = policiesSnapshot;
                    state.customerPolicies = customerPoliciesSnapshot;
                    throw error;
                }
            }
        ),
    };
    return db;
}

describe("activateDueInsurancePolicyRevisions", () => {
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    it("selects only revisions due on or before UTC today", async () => {
        const state = {
            policies: [
                policy({
                    id: 10,
                    pending_effective_date: TODAY,
                    pending_payload: { insurer_name: "Due today" },
                }),
                policy({
                    id: 11,
                    pending_effective_date: utcDay("2026-10-08"),
                    pending_payload: { insurer_name: "Tomorrow" },
                }),
                policy({ id: 12 }),
            ],
            customerPolicies: [],
        };
        const db = createMemoryDb(state);

        const result = await activateDueInsurancePolicyRevisions({
            dbClient: db as never,
            todayUtc: new Date("2026-10-07T21:30:00.000Z"),
        });

        expect(db.insurancePolicy.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { pending_effective_date: { lte: TODAY } },
            })
        );
        expect(result).toMatchObject({ processed: 1, activated: 1, failures: 0 });
        expect(state.policies.find((p) => p.id === 10)!.insurer_name).toBe(
            "Due today"
        );
        const future = state.policies.find((p) => p.id === 11)!;
        expect(future.insurer_name).toBe("Insurer");
        expect(future.pending_effective_date).toEqual(utcDay("2026-10-08"));
    });

    it("applies the snapshot, clears pending, and pushes only changed fields", async () => {
        const state = {
            policies: [
                policy({
                    id: 10,
                    pending_effective_date: TODAY,
                    pending_payload: {
                        insurer_name: "Renamed",
                        cost_percent: "0.30",
                        max_payment_term: 180,
                    },
                    pending_created_at: utcDay("2026-10-01"),
                    pending_created_by: "scheduler-user",
                }),
            ],
            customerPolicies: [
                // Diverges on max_payment_term (untouched) and cost_percent (changed).
                customerPolicy({ id: 1, customer_id: 101 }),
                // Already matches the new cost_percent: no version.
                customerPolicy({ id: 2, customer_id: 102, cost_percent: "0.30" }),
                // Has its own pending Customer Policy: skipped.
                customerPolicy({ id: 3, customer_id: 103 }),
                customerPolicy({
                    id: 4,
                    customer_id: 103,
                    is_active: false,
                    status: "pending",
                    policy_change_start_date: utcDay("2026-10-20"),
                }),
            ],
        };
        const db = createMemoryDb(state);

        const result = await activateDueInsurancePolicyRevisions({
            dbClient: db as never,
            todayUtc: TODAY,
        });

        expect(result).toEqual({
            processed: 1,
            activated: 1,
            skipped: 0,
            failures: 0,
            rewriteEnqueueFailures: 0,
            customersVersioned: 1,
        });

        const live = state.policies[0];
        expect(live).toMatchObject({
            insurer_name: "Renamed",
            cost_percent: "0.30",
            max_payment_term: 180,
            modified_by: "scheduler-user",
            pending_effective_date: null,
            pending_payload: null,
            pending_created_at: null,
            pending_created_by: null,
        });

        const versions = state.customerPolicies.filter((r) => r.id >= 1000);
        expect(versions).toHaveLength(1);
        expect(versions[0]).toMatchObject({
            customer_id: 101,
            is_active: true,
            status: "active",
            cost_percent: "0.30",
            // Untouched push field keeps the customer value.
            max_payment_term: 120,
            policy_change_start_date: TODAY,
        });
        expect(state.customerPolicies.find((r) => r.id === 1)).toMatchObject({
            is_active: false,
            status: "inactive",
        });
        expect(state.customerPolicies.find((r) => r.id === 3)).toMatchObject({
            is_active: true,
            status: "active",
        });
        expect(state.customerPolicies.find((r) => r.id === 4)!.status).toBe(
            "pending"
        );

        expect(enqueueAsOfRewrite).toHaveBeenCalledWith(
            expect.objectContaining({
                accountId: 1,
                fromDate: utcDay("2026-01-01"),
            })
        );
    });

    it("isolates a failing policy and keeps its pending revision", async () => {
        const state = {
            policies: [
                policy({
                    id: 10,
                    account_id: 1,
                    pending_effective_date: TODAY,
                    pending_payload: { start_date: "not-a-date" },
                }),
                policy({
                    id: 20,
                    account_id: 2,
                    pending_effective_date: TODAY,
                    pending_payload: { cost_percent: "0.40" },
                }),
            ],
            customerPolicies: [
                customerPolicy({
                    id: 1,
                    customer_id: 201,
                    account_id: 2,
                    insurance_policy_id: 20,
                }),
            ],
        };
        const db = createMemoryDb(state);

        const result = await activateDueInsurancePolicyRevisions({
            dbClient: db as never,
            todayUtc: TODAY,
        });

        expect(result).toMatchObject({
            processed: 2,
            activated: 1,
            failures: 1,
            customersVersioned: 1,
        });
        const failed = state.policies.find((p) => p.id === 10)!;
        expect(failed.pending_effective_date).toEqual(TODAY);
        expect(failed.pending_payload).toEqual({ start_date: "not-a-date" });
        expect(state.policies.find((p) => p.id === 20)).toMatchObject({
            cost_percent: "0.40",
            pending_effective_date: null,
        });
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining("[activateDueInsurancePolicyRevisions]"),
            expect.objectContaining({
                policyId: 10,
                accountId: 1,
                errorMessage: "start_date must be YYYY-MM-DD",
            })
        );
        expect(enqueueAsOfRewrite).toHaveBeenCalledTimes(1);
        expect(enqueueAsOfRewrite).toHaveBeenCalledWith(
            expect.objectContaining({ accountId: 2 })
        );
    });

    it("rolls back the policy apply when the customer push fails", async () => {
        const state = {
            policies: [
                policy({
                    id: 10,
                    pending_effective_date: TODAY,
                    pending_payload: { cost_percent: "0.30" },
                }),
            ],
            customerPolicies: [customerPolicy({ id: 1, customer_id: 101 })],
        };
        const db = createMemoryDb(state);
        db.failCreateForPolicyIds.add(10);

        const result = await activateDueInsurancePolicyRevisions({
            dbClient: db as never,
            todayUtc: TODAY,
        });

        expect(result).toMatchObject({ activated: 0, failures: 1 });
        expect(state.policies[0]).toMatchObject({
            cost_percent: "0.25",
            pending_effective_date: TODAY,
            pending_payload: { cost_percent: "0.30" },
        });
        expect(state.customerPolicies).toEqual([
            customerPolicy({ id: 1, customer_id: 101 }),
        ]);
        expect(enqueueAsOfRewrite).not.toHaveBeenCalled();
    });

    it("skips a revision cancelled after selection", async () => {
        const state = {
            policies: [
                policy({
                    id: 10,
                    pending_effective_date: TODAY,
                    pending_payload: { cost_percent: "0.30" },
                }),
            ],
            customerPolicies: [],
        };
        const db = createMemoryDb(state);
        db.insurancePolicy.findFirst.mockResolvedValueOnce(null);

        const result = await activateDueInsurancePolicyRevisions({
            dbClient: db as never,
            todayUtc: TODAY,
        });

        expect(result).toMatchObject({ processed: 1, activated: 0, skipped: 1 });
        expect(db.insurancePolicy.update).not.toHaveBeenCalled();
        expect(enqueueAsOfRewrite).not.toHaveBeenCalled();
    });

    it("counts a post-commit rewrite enqueue failure without undoing activation", async () => {
        const state = {
            policies: [
                policy({
                    id: 10,
                    pending_effective_date: TODAY,
                    pending_payload: { insurer_name: "Renamed" },
                }),
            ],
            customerPolicies: [],
        };
        const db = createMemoryDb(state);
        (enqueueAsOfRewrite as jest.Mock).mockRejectedValueOnce(
            new Error("queue down")
        );

        const result = await activateDueInsurancePolicyRevisions({
            dbClient: db as never,
            todayUtc: TODAY,
        });

        expect(result).toMatchObject({
            activated: 1,
            failures: 0,
            rewriteEnqueueFailures: 1,
        });
        expect(state.policies[0].pending_effective_date).toBeNull();
    });
});

describe("buildCustomerPolicyVersionFromPolicyPush", () => {
    it("never starts a version before the row it replaces", () => {
        const oldRow = {
            ...customerPolicy({
                id: 1,
                customer_id: 101,
                policy_change_start_date: utcDay("2026-10-07"),
            }),
        };
        const version = buildCustomerPolicyVersionFromPolicyPush({
            oldRow: oldRow as never,
            policy: policy({ id: 10, cost_percent: "0.30" }) as never,
            userId: "u",
            fieldsToPush: ["cost_percent"],
            versionStartDate: utcDay("2026-10-06"),
        });
        expect(version.policy_change_start_date).toEqual(utcDay("2026-10-07"));
        expect(version.cost_percent).toBe("0.30");
        expect(version.max_payment_term).toBe(120);
    });
});
