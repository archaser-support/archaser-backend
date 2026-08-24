import { SystemService } from "../src/system/system.service";

function user() {
    return { sub: "user-1", username: "admin", account_id: 42 };
}

function accessScope() {
    return {
        resolveUserInfo: jest.fn().mockResolvedValue({
            userId: "user-1",
            accountId: 42,
            role: "Admin",
        }),
        getEffectiveAccountId: jest.fn().mockReturnValue(42),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
        isAdminAccount: jest.fn().mockReturnValue(true),
    };
}

function service(database: Record<string, unknown>) {
    return new SystemService(
        database as never,
        accessScope() as never,
        {} as never,
        {} as never
    );
}

describe("control center / PTP / follow-up / cron JSON", () => {
    it("stats returns active/inactive buckets the hub reads", async () => {
        const db = {
            user: { findMany: jest.fn().mockResolvedValue([]) },
            customer: { count: jest.fn().mockResolvedValue(3) },
            invoice: { count: jest.fn().mockResolvedValue(2) },
            customerDispute: { count: jest.fn().mockResolvedValue(1) },
            account: {
                findUnique: jest.fn().mockResolvedValue({ currency: "ILS" }),
            },
        };
        const result = await service(db).getControlCenter(user(), "stats");
        expect(result.noContacts).toEqual({ active: 3, inactive: 3 });
        expect(result.invalidContacts).toEqual({ active: 3, inactive: 3 });
        expect(result.invoicesWithoutCustomer).toEqual({
            active: 2,
            inactive: 2,
        });
        expect(result.orphanCreditInvoices).toEqual({
            active: 2,
            inactive: 2,
        });
    });

    it("customers-without-contact returns customers + totalRecords", async () => {
        const db = {
            customer: {
                findMany: jest.fn().mockResolvedValue([{ id: 1 }]),
                count: jest.fn().mockResolvedValue(1),
            },
        };
        const result = await service(db).getControlCenter(
            user(),
            "customers-without-contact",
            { page: "1", limit: "25" }
        );
        expect(result).toEqual(
            expect.objectContaining({
                customers: [{ id: 1 }],
                totalRecords: 1,
            })
        );
    });

    it("orphan-credit-invoices returns invoices + totalRecords", async () => {
        const db = {
            invoice: {
                findMany: jest.fn().mockResolvedValue([{ id: 9, amount: -10 }]),
                count: jest.fn().mockResolvedValue(1),
            },
        };
        const result = await service(db).getControlCenter(
            user(),
            "orphan-credit-invoices",
            { page: "1" }
        );
        expect(result.invoices).toHaveLength(1);
        expect(result.totalRecords).toBe(1);
    });

    it("clears follow-up_time on the collection period", async () => {
        const update = jest.fn().mockResolvedValue({ id: 11 });
        const db = {
            customerCollectionPeriod: {
                findFirst: jest.fn().mockResolvedValue({ id: 11 }),
                update,
            },
        };
        const result = await service(db).clearAgentsFollowUp(user(), {
            id: 11,
        });
        expect(result).toEqual({ success: true, id: 11 });
        expect(update).toHaveBeenCalledWith({
            where: { id: 11 },
            data: { follow_up_time: null },
        });
    });

    it("PTP stats wrap counts the stats cards read", async () => {
        const db = {
            account: {
                findUnique: jest.fn().mockResolvedValue({ currency: "ILS" }),
            },
            customerCollectionPeriod: {
                count: jest.fn().mockResolvedValue(4),
                aggregate: jest.fn().mockResolvedValue({
                    _sum: {
                        promise_to_pay_amount: 10,
                        total_outstanding_amount: 50,
                        no_of_overdue_invoices: 7,
                    },
                }),
            },
        };
        const result = await service(db).getPromiseToPayStats(user());
        expect(result.stats.counts).toEqual({
            total_customers: 4,
            total_invoices: 7,
            total_outstanding_amount: 50,
            currency: "ILS",
        });
    });

    it("cron trigger returns executionId and steps", async () => {
        const db = {
            cronJob: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 3,
                    name: "nightly",
                    active: false,
                }),
            },
        };
        const result = await service(db).triggerCronJob(user(), { jobId: 3 });
        expect(result.data.executionId).toMatch(/^ack-3-/);
        expect(result.result.steps).toHaveLength(1);
    });

    it("cron logs wrap items as data.logs", async () => {
        const db = {
            log: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 1,
                        level: "INFO",
                        message: "hi",
                        timestamp: new Date("2026-01-01"),
                    },
                ]),
            },
        };
        const result = await service(db).getCronJobLogs(user(), "exec-1");
        expect(result.data.logs).toHaveLength(1);
        expect(result.data.logs[0].created_at).toBeTruthy();
    });
});
