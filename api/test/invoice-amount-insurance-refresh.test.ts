import { InvoicesService } from "../src/invoices/invoices.service";
import { ImportService } from "../src/import/import.service";
import { importMappedEntityBatch } from "@archaser/billing-connector";
import { refreshInsuranceTargetDatesForInvoiceIds } from "@archaser/credit-insurance-domain";

jest.mock("@archaser/billing-connector", () => ({
    importMappedEntityBatch: jest.fn(),
}));

jest.mock("../../packages/credit-insurance-domain/src/credit-insurance/domain/syncInvoiceReportingBreach", () => {
    const actual = jest.requireActual(
        "../../packages/credit-insurance-domain/src/credit-insurance/domain/syncInvoiceReportingBreach"
    );
    return {
        ...actual,
        refreshInsuranceTargetDatesForInvoiceIds: jest.fn(),
    };
});

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

describe("invoice amount update — insurance target refresh", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (refreshInsuranceTargetDatesForInvoiceIds as jest.Mock).mockResolvedValue(
            1
        );
    });

    it("API amount update invokes insurance target-date refresh", async () => {
        const db = {
            invoice: {
                findFirst: jest.fn().mockResolvedValue({ id: 55 }),
                update: jest.fn().mockResolvedValue({
                    id: 55,
                    amount: -100,
                }),
            },
        };
        const service = new InvoicesService(
            db as never,
            accessScope() as never
        );

        await service.update(user() as never, 55, { amount: -100 });

        expect(db.invoice.update).toHaveBeenCalled();
        expect(refreshInsuranceTargetDatesForInvoiceIds).toHaveBeenCalledWith(
            [55],
            db
        );
    });

    it("API update without amount does not invoke insurance target refresh", async () => {
        const db = {
            invoice: {
                findFirst: jest.fn().mockResolvedValue({ id: 55 }),
                update: jest.fn().mockResolvedValue({
                    id: 55,
                    status: "Open",
                }),
            },
        };
        const service = new InvoicesService(
            db as never,
            accessScope() as never
        );

        await service.update(user() as never, 55, { status: "Open" });

        expect(refreshInsuranceTargetDatesForInvoiceIds).not.toHaveBeenCalled();
    });

    it("invoice import leaf refreshes insurance targets for upserted invoice ids", async () => {
        (importMappedEntityBatch as jest.Mock).mockResolvedValue({
            success: 1,
            failed: 0,
            skipped: 0,
            affectedCustomerIds: [7],
            entityIds: [201],
            errors: [],
            rowResults: [
                { index: 0, success: true, entityId: 201, customerId: 7 },
            ],
        });

        const db = {
            importJob: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };

        const service = new ImportService(
            db as never,
            accessScope() as never,
            {} as never
        );

        await service.importLeaf("invoice", user() as never, {
            jobId: "job-1",
            invoices: [{ invoice_number: "INV-1", amount: -50 }],
        });

        expect(refreshInsuranceTargetDatesForInvoiceIds).toHaveBeenCalledWith(
            [201],
            db
        );
    });
});
