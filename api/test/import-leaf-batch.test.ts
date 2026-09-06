import { ConflictException } from "@nestjs/common";
import { ImportService } from "../src/import/import.service";
import { importMappedEntityBatch } from "@archaser/billing-connector";

jest.mock("@archaser/billing-connector", () => ({
    importMappedEntityBatch: jest.fn(),
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

describe("ImportService importLeaf bulk batch", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("sends the full invoice batch to the importer in one call", async () => {
        (importMappedEntityBatch as jest.Mock).mockResolvedValue({
            success: 2,
            failed: 0,
            skipped: 0,
            affectedCustomerIds: [7],
            entityIds: [101, 102],
            errors: [],
            rowResults: [
                { index: 0, success: true, entityId: 101, customerId: 7 },
                { index: 1, success: true, entityId: 102, customerId: 7 },
            ],
        });

        const db = {
            importJob: {
                findFirst: jest
                    .fn()
                    .mockResolvedValueOnce({
                        id: "job-1",
                        import_type: "Invoice",
                        status: "Pending",
                        metadata: {},
                    })
                    .mockResolvedValueOnce(null),
                update: jest.fn().mockResolvedValue({}),
            },
            importRecord: {
                createMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
        };

        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );

        const result = await service.importLeaf("invoice", user() as never, {
            jobId: "job-1",
            invoices: [
                { invoice_number: "INV-1", customer_number: "CUST1" },
                { invoice_number: "INV-2", customer_number: "CUST1" },
            ],
        });

        expect(importMappedEntityBatch).toHaveBeenCalledTimes(1);
        expect(importMappedEntityBatch).toHaveBeenCalledWith(
            db,
            "Invoice",
            [
                { invoice_number: "INV-1", customer_number: "CUST1" },
                { invoice_number: "INV-2", customer_number: "CUST1" },
            ],
            42,
            null,
            "user-1"
        );
        expect(db.importRecord.createMany).toHaveBeenCalledTimes(1);
        expect(result.successful).toBe(2);
        expect(result.processed).toBe(2);
    });

    it("importLeaf rejects when another job is Processing on the account", async () => {
        const db = {
            importJob: {
                findFirst: jest
                    .fn()
                    .mockResolvedValueOnce({
                        id: "job-2",
                        import_type: "Customer",
                        status: "Pending",
                        metadata: {},
                    })
                    .mockResolvedValueOnce({ id: "job-other" }),
            },
        };
        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );

        await expect(
            service.importLeaf("customer", user() as never, {
                jobId: "job-2",
                customers: [{ customer_number: "C1" }],
            })
        ).rejects.toMatchObject({
            response: {
                code: "IMPORT_IN_PROGRESS",
                error: expect.any(String),
            },
        });
        expect(importMappedEntityBatch).not.toHaveBeenCalled();
    });

    it("importLeaf throws ConflictException for unrelated Processing job", async () => {
        const db = {
            importJob: {
                findFirst: jest
                    .fn()
                    .mockResolvedValueOnce({
                        id: "job-2",
                        import_type: "Invoice",
                        status: "Pending",
                        metadata: {},
                    })
                    .mockResolvedValueOnce({ id: "job-other" }),
            },
        };
        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );

        await expect(
            service.importLeaf("invoice", user() as never, {
                jobId: "job-2",
                invoices: [{ invoice_number: "INV-1" }],
            })
        ).rejects.toBeInstanceOf(ConflictException);
    });
});
