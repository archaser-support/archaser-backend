import { ImportService } from "../src/import/import.service";
import { runArPostIngestForCustomers } from "../src/credit-insurance/domain/arPostIngestOrchestrator";
import { enqueueRewriteForImport } from "../src/credit-insurance/domain/asOfRewriteQueue";
import { recalculateCustomerAmounts } from "../src/customers/domain/recalculateCustomerAmounts";

jest.mock("../src/credit-insurance/domain/arPostIngestOrchestrator", () => ({
    runArPostIngestForCustomers: jest.fn(),
}));

jest.mock("../src/credit-insurance/domain/asOfRewriteQueue", () => ({
    enqueueRewriteForImport: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/customers/domain/recalculateCustomerAmounts", () => ({
    recalculateCustomerAmounts: jest.fn().mockResolvedValue(undefined),
}));

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
    };
}

function completedJob(overrides: Record<string, unknown> = {}) {
    return {
        id: "job-1",
        account_id: 42,
        status: "Completed",
        ...overrides,
    };
}

describe("ImportService completeJob post-ingest", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (runArPostIngestForCustomers as jest.Mock).mockResolvedValue({
            skipped: false,
            errors: [],
        });
    });

    it("Invoice complete invokes orchestrator with replay, live refresh, and as-of", async () => {
        const db = {
            importJob: {
                findFirst: jest.fn().mockResolvedValue({
                    id: "job-1",
                    import_type: "Invoice",
                    metadata: {
                        asOfRewriteCustomerIds: [7, 8],
                        asOfRewriteEntityIds: [101, 102],
                    },
                }),
                update: jest.fn().mockResolvedValue(
                    completedJob({ import_type: "Invoice" })
                ),
            },
        };
        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );

        const result = await service.completeJob(user(), { jobId: "job-1" });

        expect(result.status).toBe("Completed");
        expect(runArPostIngestForCustomers).toHaveBeenCalledWith({
            accountId: 42,
            customerIds: [7, 8],
            runReplay: true,
            runLiveRefresh: true,
            enqueueAsOfRewrite: true,
            asOfRewrite: {
                importType: "Invoice",
                entityIds: [101, 102],
            },
        });
        expect(enqueueRewriteForImport).not.toHaveBeenCalled();
        expect(recalculateCustomerAmounts).toHaveBeenCalledWith(
            [7, 8],
            db
        );
    });

    it("Payment complete invokes orchestrator with the same options shape", async () => {
        const db = {
            importJob: {
                findFirst: jest.fn().mockResolvedValue({
                    id: "job-pay",
                    import_type: "Payment",
                    metadata: {
                        asOfRewriteCustomerIds: [3],
                        asOfRewriteEntityIds: [501],
                    },
                }),
                update: jest.fn().mockResolvedValue(
                    completedJob({ id: "job-pay", import_type: "Payment" })
                ),
            },
        };
        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );

        await service.completeJob(user(), { jobId: "job-pay" });

        expect(runArPostIngestForCustomers).toHaveBeenCalledWith({
            accountId: 42,
            customerIds: [3],
            runReplay: true,
            runLiveRefresh: true,
            enqueueAsOfRewrite: true,
            asOfRewrite: {
                importType: "Payment",
                entityIds: [501],
            },
        });
    });

    it("keeps job Completed when post-ingest orchestrator throws", async () => {
        (runArPostIngestForCustomers as jest.Mock).mockRejectedValue(
            new Error("replay boom")
        );
        const db = {
            importJob: {
                findFirst: jest.fn().mockResolvedValue({
                    id: "job-1",
                    import_type: "Invoice",
                    metadata: {
                        asOfRewriteCustomerIds: [7],
                        asOfRewriteEntityIds: [101],
                    },
                }),
                update: jest.fn().mockResolvedValue(
                    completedJob({ import_type: "Invoice" })
                ),
            },
        };
        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );

        const result = await service.completeJob(user(), { jobId: "job-1" });

        expect(result.status).toBe("Completed");
        expect(enqueueRewriteForImport).toHaveBeenCalledWith({
            accountId: 42,
            importType: "Invoice",
            entityIds: [101],
            customerIds: [7],
        });
        expect(recalculateCustomerAmounts).toHaveBeenCalled();
    });

    it("falls back to as-of enqueue when orchestrator skips (collection-only)", async () => {
        (runArPostIngestForCustomers as jest.Mock).mockResolvedValue({
            skipped: true,
            skipReason: "no_credit_insurance",
            errors: [],
        });
        const db = {
            importJob: {
                findFirst: jest.fn().mockResolvedValue({
                    id: "job-1",
                    import_type: "Payment",
                    metadata: {
                        asOfRewriteCustomerIds: [9],
                        asOfRewriteEntityIds: [77],
                    },
                }),
                update: jest.fn().mockResolvedValue(
                    completedJob({ import_type: "Payment" })
                ),
            },
        };
        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );

        const result = await service.completeJob(user(), { jobId: "job-1" });

        expect(result.status).toBe("Completed");
        expect(enqueueRewriteForImport).toHaveBeenCalledWith({
            accountId: 42,
            importType: "Payment",
            entityIds: [77],
            customerIds: [9],
        });
        expect(recalculateCustomerAmounts).toHaveBeenCalledWith([9], db);
    });
});
