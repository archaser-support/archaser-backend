import { ImportService } from "../src/import/import.service";
import { runArPostIngestForCustomers } from "@archaser/cron-jobs";
import { enqueueRewriteForImport } from "@archaser/credit-insurance-domain";
import { recalculateCustomerAmounts } from "../src/customers/domain/recalculateCustomerAmounts";

jest.mock("@archaser/cron-jobs", () => ({
    runArPostIngestForCustomers: jest.fn(),
}));

jest.mock("../../packages/credit-insurance-domain/src/credit-insurance/domain/asOfRewriteQueue", () => ({
    ...jest.requireActual(
        "../../packages/credit-insurance-domain/src/credit-insurance/domain/asOfRewriteQueue"
    ),
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

function arCompleteDb(overrides: {
    existing?: Record<string, unknown>;
    jobId?: string;
    importType?: "Invoice" | "Payment";
}) {
    const jobId = overrides.jobId ?? "job-1";
    const importType = overrides.importType ?? "Invoice";
    const update = jest
        .fn()
        .mockResolvedValue(
            completedJob({ id: jobId, import_type: importType })
        );
    return {
        db: {
            importJob: {
                findFirst: jest.fn().mockResolvedValue({
                    id: jobId,
                    import_type: importType,
                    metadata: {
                        asOfRewriteCustomerIds: [7, 8],
                        asOfRewriteEntityIds: [101, 102],
                    },
                    ...overrides.existing,
                }),
                update,
                findUnique: jest.fn().mockResolvedValue({ metadata: {} }),
            },
        },
        update,
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
        const { db, update } = arCompleteDb({});
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
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({
            where: { id: "job-1" },
            data: expect.objectContaining({
                status: "Completed",
                completed_at: expect.any(Date),
            }),
        });
    });

    it("Payment complete invokes orchestrator with the same options shape", async () => {
        const { db, update } = arCompleteDb({
            jobId: "job-pay",
            importType: "Payment",
            existing: {
                metadata: {
                    asOfRewriteCustomerIds: [3],
                    asOfRewriteEntityIds: [501],
                },
            },
        });
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
        expect(update).toHaveBeenCalledWith({
            where: { id: "job-pay" },
            data: expect.objectContaining({ status: "Completed" }),
        });
    });

    it("keeps job Completed when post-ingest orchestrator throws", async () => {
        (runArPostIngestForCustomers as jest.Mock).mockRejectedValue(
            new Error("replay boom")
        );
        const { db, update } = arCompleteDb({
            existing: {
                metadata: {
                    asOfRewriteCustomerIds: [7],
                    asOfRewriteEntityIds: [101],
                },
            },
        });
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
        expect(update).toHaveBeenCalledWith({
            where: { id: "job-1" },
            data: expect.objectContaining({ status: "Completed" }),
        });
    });

    it("falls back to as-of enqueue when orchestrator skips (collection-only)", async () => {
        (runArPostIngestForCustomers as jest.Mock).mockResolvedValue({
            skipped: true,
            skipReason: "no_credit_insurance",
            errors: [],
        });
        const { db, update } = arCompleteDb({
            importType: "Payment",
            existing: {
                metadata: {
                    asOfRewriteCustomerIds: [9],
                    asOfRewriteEntityIds: [77],
                },
            },
        });
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
        expect(update).toHaveBeenCalledWith({
            where: { id: "job-1" },
            data: expect.objectContaining({ status: "Completed" }),
        });
    });

    it("Invoice complete sets Completed only after orchestrator resolves", async () => {
        let resolveOrchestrator: (value: unknown) => void = () => {};
        const orchestratorDone = new Promise((resolve) => {
            resolveOrchestrator = resolve;
        });
        (runArPostIngestForCustomers as jest.Mock).mockReturnValue(
            orchestratorDone
        );

        const { db, update } = arCompleteDb({});
        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );

        const completePromise = service.completeJob(user(), { jobId: "job-1" });

        await Promise.resolve();
        expect(update).not.toHaveBeenCalled();

        resolveOrchestrator({ skipped: false, errors: [] });
        const result = await completePromise;

        expect(result.status).toBe("Completed");
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({
            where: { id: "job-1" },
            data: expect.objectContaining({
                status: "Completed",
                completed_at: expect.any(Date),
            }),
        });
    });

    it("Customer complete sets Completed immediately without orchestrator", async () => {
        const update = jest.fn().mockResolvedValue(
            completedJob({ import_type: "Customer" })
        );
        const db = {
            importJob: {
                findFirst: jest.fn().mockResolvedValue({
                    id: "job-cust",
                    import_type: "Customer",
                    metadata: {},
                }),
                update,
            },
        };
        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );

        const result = await service.completeJob(user(), { jobId: "job-cust" });

        expect(result.status).toBe("Completed");
        expect(runArPostIngestForCustomers).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({
            where: { id: "job-cust" },
            data: expect.objectContaining({
                status: "Completed",
                completed_at: expect.any(Date),
            }),
        });
    });
});
