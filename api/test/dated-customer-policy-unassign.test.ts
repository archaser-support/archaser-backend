import {
    activateDuePendingCustomerPolicies,
    applyDatedCustomerPolicyUnassign,
    clipCustomerTopUpsFromUnassignDay,
    DatedCustomerPolicyUnassignError,
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
    policy_change_start_date: Date;
    policy_change_end_date: Date | null;
    status: "active" | "pending" | "inactive";
    is_active: boolean;
    modified_by: string | null;
};

type TopUpRow = {
    id: number;
    customer_id: number;
    start_date: Date;
    end_date: Date;
    cancelled_at: Date | null;
    modified_by: string | null;
};

type InvoiceRow = {
    id: number;
    customer_id: number;
    policy_id: number | null;
    invoice_date: Date;
};

function utcDay(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

type InsurancePolicyRow = {
    id: number;
    start_date: Date;
};

function createMemoryDb(args: {
    customers: CustomerRow[];
    policies: PolicyRow[];
    topUps: TopUpRow[];
    invoices: InvoiceRow[];
    insurancePolicies?: InsurancePolicyRow[];
}) {
    const { customers, policies, topUps, invoices } = args;
    const insurancePolicies = args.insurancePolicies ?? [
        { id: 77, start_date: utcDay("2024-04-01") },
    ];
    return {
        customer: {
            findUnique: jest.fn(async ({ where }: { where: { id: number } }) => {
                const row = customers.find((c) => c.id === where.id);
                return row
                    ? { parent_customer_id: row.parent_customer_id }
                    : null;
            }),
        },
        insurancePolicy: {
            findUnique: jest.fn(
                async ({ where }: { where: { id: number } }) => {
                    return (
                        insurancePolicies.find((row) => row.id === where.id) ??
                        null
                    );
                }
            ),
        },
        customerPolicy: {
            findFirst: jest.fn(
                async ({
                    where,
                }: {
                    where: {
                        customer_id: number;
                        is_active?: boolean;
                        status?: string;
                    };
                }) => {
                    return (
                        policies.find((row) => {
                            if (row.customer_id !== where.customer_id) {
                                return false;
                            }
                            if (
                                where.status != null &&
                                row.status !== where.status
                            ) {
                                return false;
                            }
                            if (
                                where.is_active != null &&
                                row.is_active !== where.is_active
                            ) {
                                return false;
                            }
                            return true;
                        }) ?? null
                    );
                }
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
                        throw new Error("policy not found");
                    }
                    Object.assign(row, data);
                    return row;
                }
            ),
            create: jest.fn(
                async ({ data }: { data: Partial<PolicyRow> & { customer_id: number } }) => {
                    const row: PolicyRow = {
                        id:
                            policies.reduce(
                                (max, p) => Math.max(max, p.id),
                                0
                            ) + 1,
                        customer_id: data.customer_id,
                        insurance_policy_id: data.insurance_policy_id ?? null,
                        policy_change_start_date:
                            data.policy_change_start_date ?? utcDay("1970-01-01"),
                        policy_change_end_date:
                            data.policy_change_end_date ?? null,
                        status: data.status ?? "inactive",
                        is_active: data.is_active ?? false,
                        modified_by: data.modified_by ?? null,
                    };
                    policies.push(row);
                    return row;
                }
            ),
            findMany: jest.fn(
                async ({
                    where,
                }: {
                    where: {
                        customer_id?: number;
                        insurance_policy_id?: number | null;
                        status?: string;
                        policy_change_start_date?: { lte: Date };
                    };
                }) => {
                    return policies
                        .filter((row) => {
                            if (
                                where.customer_id != null &&
                                row.customer_id !== where.customer_id
                            ) {
                                return false;
                            }
                            if (
                                where.insurance_policy_id !== undefined &&
                                row.insurance_policy_id !==
                                    where.insurance_policy_id
                            ) {
                                return false;
                            }
                            if (
                                where.status != null &&
                                row.status !== where.status
                            ) {
                                return false;
                            }
                            if (
                                where.policy_change_start_date?.lte != null &&
                                row.policy_change_start_date.getTime() >
                                    where.policy_change_start_date.lte.getTime()
                            ) {
                                return false;
                            }
                            return true;
                        })
                        .map((row) => ({
                            ...row,
                            Customer: {
                                account_id:
                                    customers.find((c) => c.id === row.customer_id)
                                        ?.account_id ?? 1,
                            },
                        }));
                }
            ),
        },
        customerTopUp: {
            findMany: jest.fn(
                async ({
                    where,
                }: {
                    where: { customer_id: number; cancelled_at: null };
                }) =>
                    topUps.filter(
                        (row) =>
                            row.customer_id === where.customer_id &&
                            row.cancelled_at == null
                    )
            ),
            update: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: { id: number };
                    data: Partial<TopUpRow>;
                }) => {
                    const row = topUps.find((t) => t.id === where.id);
                    if (!row) {
                        throw new Error("top-up not found");
                    }
                    Object.assign(row, data);
                    return row;
                }
            ),
        },
        invoice: {
            updateMany: jest.fn(
                async ({
                    where,
                    data,
                }: {
                    where: {
                        customer_id: number;
                        policy_id: number;
                        invoice_date: { gte: Date };
                    };
                    data: { policy_id: null };
                }) => {
                    let count = 0;
                    for (const row of invoices) {
                        if (row.customer_id !== where.customer_id) {
                            continue;
                        }
                        if (row.policy_id !== where.policy_id) {
                            continue;
                        }
                        if (row.invoice_date.getTime() < where.invoice_date.gte.getTime()) {
                            continue;
                        }
                        row.policy_id = data.policy_id;
                        count += 1;
                    }
                    return { count };
                }
            ),
        },
        __policies: policies,
        __topUps: topUps,
        __invoices: invoices,
    };
}

describe("dated customer policy unassign", () => {
    it("clips overlapping top-ups to the day before unassign and cancels windows that start on or after", async () => {
        const topUps: TopUpRow[] = [
            {
                id: 1,
                customer_id: 10,
                start_date: utcDay("2026-03-01"),
                end_date: utcDay("2026-03-31"),
                cancelled_at: null,
                modified_by: null,
            },
            {
                id: 2,
                customer_id: 10,
                start_date: utcDay("2026-03-15"),
                end_date: utcDay("2026-03-20"),
                cancelled_at: null,
                modified_by: null,
            },
            {
                id: 3,
                customer_id: 10,
                start_date: utcDay("2026-02-01"),
                end_date: utcDay("2026-03-10"),
                cancelled_at: null,
                modified_by: null,
            },
        ];
        const db = createMemoryDb({
            customers: [{ id: 10, account_id: 1, parent_customer_id: null }],
            policies: [],
            topUps,
            invoices: [],
        });

        await clipCustomerTopUpsFromUnassignDay(10, utcDay("2026-03-15"), {
            dbClient: db as never,
            userId: "user-1",
            now: new Date("2026-03-15T12:00:00.000Z"),
        });

        expect(topUps[0]!.end_date).toEqual(utcDay("2026-03-14"));
        expect(topUps[0]!.cancelled_at).toBeNull();
        expect(topUps[1]!.cancelled_at).toEqual(
            new Date("2026-03-15T12:00:00.000Z")
        );
        expect(topUps[2]!.end_date).toEqual(utcDay("2026-03-10"));
    });

    it("rejects unassign before the insurance policy start and missing active policy", async () => {
        const policies: PolicyRow[] = [
            {
                id: 5,
                customer_id: 10,
                insurance_policy_id: 77,
                policy_change_start_date: utcDay("2026-03-01"),
                policy_change_end_date: null,
                status: "active",
                is_active: true,
                modified_by: null,
            },
        ];
        const db = createMemoryDb({
            customers: [{ id: 10, account_id: 1, parent_customer_id: null }],
            policies,
            topUps: [],
            invoices: [],
            insurancePolicies: [{ id: 77, start_date: utcDay("2024-04-01") }],
        });
        const hooks = {
            freezeCustomerPolicyGapOnDeactivation: jest.fn(async () => undefined),
            remirrorCreditPoolAfterPolicyMutation: jest.fn(async () => ({
                rootCustomerId: 10,
                mirroredCustomerIds: [] as number[],
            })),
            rewriteCustomerAsOfRange: jest.fn(async () => ({
                daysRewritten: 0,
                skipped: true,
            })),
            refreshTermsFlags: false,
        };

        await expect(
            applyDatedCustomerPolicyUnassign({
                customerId: 10,
                accountId: 1,
                userId: "u",
                unassignDate: utcDay("2024-03-31"),
                dbClient: db as never,
                ...hooks,
            })
        ).rejects.toMatchObject({
            code: "UNASSIGN_DATE_BEFORE_POLICY_START",
        } satisfies Partial<DatedCustomerPolicyUnassignError>);

        policies[0]!.is_active = false;
        policies[0]!.status = "inactive";
        await expect(
            applyDatedCustomerPolicyUnassign({
                customerId: 10,
                accountId: 1,
                userId: "u",
                unassignDate: utcDay("2026-03-15"),
                dbClient: db as never,
                ...hooks,
            })
        ).rejects.toMatchObject({ code: "NO_ACTIVE_POLICY" });
    });

    it("allows unassign before later copy-on-write versions when the date is on or after the product start", async () => {
        const policies: PolicyRow[] = [
            {
                id: 5,
                customer_id: 10,
                insurance_policy_id: 77,
                policy_change_start_date: utcDay("2026-08-31"),
                policy_change_end_date: null,
                status: "inactive",
                is_active: false,
                modified_by: null,
            },
            {
                id: 6,
                customer_id: 10,
                insurance_policy_id: 77,
                policy_change_start_date: utcDay("2026-10-06"),
                policy_change_end_date: null,
                status: "active",
                is_active: true,
                modified_by: null,
            },
        ];
        const db = createMemoryDb({
            customers: [{ id: 10, account_id: 1, parent_customer_id: null }],
            policies,
            topUps: [],
            invoices: [],
            insurancePolicies: [{ id: 77, start_date: utcDay("2024-04-01") }],
        });
        const rewrite = jest.fn(async () => ({
            daysRewritten: 0,
            skipped: true,
        }));

        await applyDatedCustomerPolicyUnassign({
            customerId: 10,
            accountId: 1,
            userId: "u",
            unassignDate: utcDay("2026-07-01"),
            dbClient: db as never,
            freezeCustomerPolicyGapOnDeactivation: jest.fn(async () => undefined),
            remirrorCreditPoolAfterPolicyMutation: jest.fn(async () => ({
                rootCustomerId: 10,
                mirroredCustomerIds: [] as number[],
            })),
            rewriteCustomerAsOfRange: rewrite as never,
            refreshTermsFlags: false,
        });

        expect(policies[0]!.is_active).toBe(false);
        expect(policies[0]!.status).toBe("inactive");
        expect(policies[0]!.policy_change_end_date).toEqual(utcDay("2026-08-31"));
        expect(policies[1]!.is_active).toBe(false);
        expect(policies[1]!.status).toBe("inactive");
        expect(policies[1]!.policy_change_end_date).toEqual(utcDay("2026-10-06"));
        expect(rewrite).toHaveBeenCalledWith(
            expect.objectContaining({ fromDate: utcDay("2026-07-01") }),
            expect.anything()
        );
    });

    it("ends TF1, strips later invoices, clips top-ups, and rewrites from the unassign day", async () => {
        const policies: PolicyRow[] = [
            {
                id: 5,
                customer_id: 10,
                insurance_policy_id: 77,
                policy_change_start_date: utcDay("2026-03-01"),
                policy_change_end_date: null,
                status: "active",
                is_active: true,
                modified_by: null,
            },
        ];
        const topUps: TopUpRow[] = [
            {
                id: 1,
                customer_id: 10,
                start_date: utcDay("2026-03-01"),
                end_date: utcDay("2026-03-31"),
                cancelled_at: null,
                modified_by: null,
            },
        ];
        const invoices: InvoiceRow[] = [
            {
                id: 1,
                customer_id: 10,
                policy_id: 77,
                invoice_date: utcDay("2026-03-10"),
            },
            {
                id: 2,
                customer_id: 10,
                policy_id: 77,
                invoice_date: utcDay("2026-03-15"),
            },
        ];
        const db = createMemoryDb({
            customers: [{ id: 10, account_id: 1, parent_customer_id: null }],
            policies,
            topUps,
            invoices,
        });
        const rewrite = jest.fn(async () => ({
            daysRewritten: 1,
            skipped: false,
        }));

        const result = await applyDatedCustomerPolicyUnassign({
            customerId: 10,
            accountId: 1,
            userId: "u",
            unassignDate: utcDay("2026-03-15"),
            dbClient: db as never,
            freezeCustomerPolicyGapOnDeactivation: jest.fn(async () => undefined),
            remirrorCreditPoolAfterPolicyMutation: jest.fn(async () => ({
                rootCustomerId: 10,
                mirroredCustomerIds: [],
            })),
            rewriteCustomerAsOfRange: rewrite as never,
            refreshTermsFlags: false,
        });

        expect(result.customerPolicyId).toBe(5);
        expect(policies[0]!.is_active).toBe(false);
        expect(policies[0]!.status).toBe("inactive");
        expect(policies[0]!.policy_change_end_date).toEqual(utcDay("2026-03-15"));
        expect(invoices[0]!.policy_id).toBe(77);
        expect(invoices[1]!.policy_id).toBeNull();
        expect(topUps[0]!.end_date).toEqual(utcDay("2026-03-14"));
        expect(rewrite).toHaveBeenCalledWith(
            expect.objectContaining({
                accountId: 1,
                customerIds: [10],
                fromDate: utcDay("2026-03-15"),
            }),
            expect.objectContaining({ preserveHistoryBeforeFromDate: true })
        );
    });

    it("schedules a future unassign as one pending null-policy row without clip, strip, or rewrite", async () => {
        const tomorrow = new Date();
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const tomorrowUtc = new Date(
            Date.UTC(
                tomorrow.getUTCFullYear(),
                tomorrow.getUTCMonth(),
                tomorrow.getUTCDate()
            )
        );
        const policies: PolicyRow[] = [
            {
                id: 5,
                customer_id: 10,
                insurance_policy_id: 77,
                policy_change_start_date: utcDay("2026-03-01"),
                policy_change_end_date: null,
                status: "active",
                is_active: true,
                modified_by: null,
            },
        ];
        const topUps: TopUpRow[] = [
            {
                id: 1,
                customer_id: 10,
                start_date: utcDay("2026-03-01"),
                end_date: utcDay("2026-12-31"),
                cancelled_at: null,
                modified_by: null,
            },
        ];
        const invoices: InvoiceRow[] = [
            {
                id: 1,
                customer_id: 10,
                policy_id: 77,
                invoice_date: utcDay("2026-03-10"),
            },
        ];
        const db = createMemoryDb({
            customers: [{ id: 10, account_id: 1, parent_customer_id: null }],
            policies,
            topUps,
            invoices,
        });
        const remirror = jest.fn(async () => ({
            rootCustomerId: 10,
            mirroredCustomerIds: [] as number[],
        }));
        const rewrite = jest.fn(async () => ({
            daysRewritten: 0,
            skipped: true,
        }));

        const result = await applyDatedCustomerPolicyUnassign({
            customerId: 10,
            accountId: 1,
            userId: "u",
            unassignDate: tomorrowUtc,
            dbClient: db as never,
            freezeCustomerPolicyGapOnDeactivation: jest.fn(async () => undefined),
            remirrorCreditPoolAfterPolicyMutation: remirror,
            rewriteCustomerAsOfRange: rewrite as never,
            refreshTermsFlags: false,
        });

        const pending = policies.find((row) => row.status === "pending");
        expect(pending).toMatchObject({
            insurance_policy_id: null,
            is_active: false,
            policy_change_start_date: tomorrowUtc,
            policy_change_end_date: null,
        });
        expect(result.customerPolicyId).toBe(pending!.id);
        expect(policies[0]!.is_active).toBe(true);
        expect(policies[0]!.status).toBe("active");
        expect(policies[0]!.policy_change_end_date).toBeNull();
        expect(topUps[0]!.end_date).toEqual(utcDay("2026-12-31"));
        expect(topUps[0]!.cancelled_at).toBeNull();
        expect(invoices[0]!.policy_id).toBe(77);
        expect(rewrite).not.toHaveBeenCalled();
        expect(remirror).toHaveBeenCalled();

        await expect(
            applyDatedCustomerPolicyUnassign({
                customerId: 10,
                accountId: 1,
                userId: "u",
                unassignDate: tomorrowUtc,
                dbClient: db as never,
                freezeCustomerPolicyGapOnDeactivation: jest.fn(
                    async () => undefined
                ),
                remirrorCreditPoolAfterPolicyMutation: remirror,
                rewriteCustomerAsOfRange: rewrite as never,
                refreshTermsFlags: false,
            })
        ).rejects.toMatchObject({ code: "PENDING_POLICY_CHANGE_EXISTS" });
    });

    it("cancel of a pending unassign inactivates the row without rewrite or clip", async () => {
        const tomorrow = new Date();
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const tomorrowUtc = new Date(
            Date.UTC(
                tomorrow.getUTCFullYear(),
                tomorrow.getUTCMonth(),
                tomorrow.getUTCDate()
            )
        );
        const policies: PolicyRow[] = [
            {
                id: 5,
                customer_id: 10,
                insurance_policy_id: 77,
                policy_change_start_date: utcDay("2026-03-01"),
                policy_change_end_date: null,
                status: "active",
                is_active: true,
                modified_by: null,
            },
        ];
        const topUps: TopUpRow[] = [
            {
                id: 1,
                customer_id: 10,
                start_date: utcDay("2026-03-01"),
                end_date: utcDay("2026-12-31"),
                cancelled_at: null,
                modified_by: null,
            },
        ];
        const db = createMemoryDb({
            customers: [{ id: 10, account_id: 1, parent_customer_id: null }],
            policies,
            topUps,
            invoices: [],
        });
        const rewrite = jest.fn(async () => ({
            daysRewritten: 0,
            skipped: true,
        }));

        await applyDatedCustomerPolicyUnassign({
            customerId: 10,
            accountId: 1,
            userId: "u",
            unassignDate: tomorrowUtc,
            dbClient: db as never,
            freezeCustomerPolicyGapOnDeactivation: jest.fn(async () => undefined),
            remirrorCreditPoolAfterPolicyMutation: jest.fn(async () => ({
                rootCustomerId: 10,
                mirroredCustomerIds: [] as number[],
            })),
            rewriteCustomerAsOfRange: rewrite as never,
            refreshTermsFlags: false,
        });

        const pending = policies.find((row) => row.status === "pending")!;
        await db.customerPolicy.update({
            where: { id: pending.id },
            data: { status: "inactive", is_active: false, modified_by: "u" },
        });

        expect(policies[0]!.is_active).toBe(true);
        expect(pending.status).toBe("inactive");
        expect(pending.is_active).toBe(false);
        expect(topUps[0]!.end_date).toEqual(utcDay("2026-12-31"));
        expect(rewrite).not.toHaveBeenCalled();
    });

    it("activating a due pending unassign applies run-off and does not leave pending active", async () => {
        const todayUtc = new Date();
        todayUtc.setUTCHours(0, 0, 0, 0);
        const policies: PolicyRow[] = [
            {
                id: 5,
                customer_id: 10,
                insurance_policy_id: 77,
                policy_change_start_date: utcDay("2026-03-01"),
                policy_change_end_date: null,
                status: "active",
                is_active: true,
                modified_by: null,
            },
            {
                id: 9,
                customer_id: 10,
                insurance_policy_id: null,
                policy_change_start_date: todayUtc,
                policy_change_end_date: null,
                status: "pending",
                is_active: false,
                modified_by: null,
            },
        ];
        const topUps: TopUpRow[] = [
            {
                id: 1,
                customer_id: 10,
                start_date: utcDay("2026-03-01"),
                end_date: utcDay("2026-12-31"),
                cancelled_at: null,
                modified_by: null,
            },
        ];
        const invoices: InvoiceRow[] = [
            {
                id: 1,
                customer_id: 10,
                policy_id: 77,
                invoice_date: utcDay("2026-03-10"),
            },
            {
                id: 2,
                customer_id: 10,
                policy_id: 77,
                invoice_date: todayUtc,
            },
        ];
        const db = createMemoryDb({
            customers: [{ id: 10, account_id: 1, parent_customer_id: null }],
            policies,
            topUps,
            invoices,
        });
        const rewrite = jest.fn(async () => ({
            daysRewritten: 1,
            skipped: false,
        }));
        const freeze = jest.fn(async () => undefined);
        const remirror = jest.fn(async () => ({
            rootCustomerId: 10,
            mirroredCustomerIds: [] as number[],
        }));

        const result = await activateDuePendingCustomerPolicies({
            dbClient: db as never,
            applyDatedCustomerPolicyUnassign: (args) =>
                applyDatedCustomerPolicyUnassign({
                    ...args,
                    freezeCustomerPolicyGapOnDeactivation: freeze,
                    remirrorCreditPoolAfterPolicyMutation: remirror,
                    rewriteCustomerAsOfRange: rewrite as never,
                    refreshTermsFlags: false,
                }),
        });

        expect(result.activated).toBe(1);
        expect(result.failures).toBe(0);
        expect(policies[0]!.is_active).toBe(false);
        expect(policies[0]!.status).toBe("inactive");
        expect(policies[0]!.policy_change_end_date).toEqual(todayUtc);
        expect(policies[1]!.status).toBe("inactive");
        expect(policies[1]!.is_active).toBe(false);
        expect(policies.some((row) => row.is_active)).toBe(false);
        expect(topUps[0]!.end_date.getTime()).toBeLessThan(todayUtc.getTime());
        expect(invoices[0]!.policy_id).toBe(77);
        expect(invoices[1]!.policy_id).toBeNull();
        expect(rewrite).toHaveBeenCalled();
    });
});
