import { InvoicesService } from "../src/invoices/invoices.service";
import { ImportService } from "../src/import/import.service";
import { importMappedEntityBatch } from "@archaser/billing-connector";
import {
    loadEffectiveInsuranceForCustomers,
    refreshInsuranceTargetDatesForInvoiceIds,
} from "@archaser/credit-insurance-domain";

jest.mock("@archaser/billing-connector", () => ({
    importMappedEntityBatch: jest.fn(),
}));

// Mock the shared package's internal modules, not its entry point, so the real
// implementation under test still resolves the mocked loader through its own
// relative import.
jest.mock("../../packages/credit-insurance-domain/src/credit-insurance/domain/syncInvoiceReportingBreach", () => {
    const actual = jest.requireActual(
        "../../packages/credit-insurance-domain/src/credit-insurance/domain/syncInvoiceReportingBreach"
    );
    return {
        ...actual,
        refreshInsuranceTargetDatesForInvoiceIds: jest.fn(),
    };
});

jest.mock("../../packages/credit-insurance-domain/src/credit-insurance/domain/loadEffectiveInsuranceForCustomers", () => ({
    loadEffectiveInsuranceForCustomers: jest.fn(),
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
                findFirst: jest.fn().mockResolvedValue({
                    id: "job-1",
                    import_type: "Invoice",
                    status: "Pending",
                    metadata: {},
                }),
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

describe("refreshInsuranceTargetDatesForInvoiceIds — amount sign flip", () => {
    const { refreshInsuranceTargetDatesForInvoiceIds: refreshReal } =
        jest.requireActual(
            "../../packages/credit-insurance-domain/src/credit-insurance/domain/syncInvoiceReportingBreach"
        ) as {
            refreshInsuranceTargetDatesForInvoiceIds: (
                ids: number[],
                db: unknown
            ) => Promise<number>;
        };

    beforeEach(() => {
        jest.clearAllMocks();
        (loadEffectiveInsuranceForCustomers as jest.Mock).mockResolvedValue(
            new Map([
                [
                    9,
                    {
                        id: 9,
                        reporting_days: 5,
                        max_allowed_mep: 7,
                        mep_cutoff_day_of_month: null,
                        mep_substitute_day_of_month: null,
                        reporting_cutoff_day_of_month: null,
                        reporting_substitute_day_of_month: null,
                        payment_term_cutoff_day_of_month: null,
                        payment_term_substitute_day_of_month: null,
                        max_payment_term: 30,
                        overdue_block: false,
                        excluded_from_policy: false,
                        policy_exclusion_reason: null,
                        credit_score_input_date: null,
                        policy_id: 1,
                        limit_type: null,
                        credit_score: null,
                        active_customer_since: null,
                        approved_limit: null,
                        approved_limit_currency: null,
                    },
                ],
            ])
        );
    });

    it("nulls target MEP and reporting dates when amount is negative", async () => {
        const updates: Array<Record<string, unknown>> = [];
        const db = {
            invoice: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 1,
                        amount: -200,
                        invoice_date: new Date("2025-01-01"),
                        due_date: new Date("2025-01-10"),
                        target_reporting_date: new Date("2025-01-15"),
                        target_mep_date: new Date("2025-01-17"),
                        customer_id: 9,
                    },
                ]),
                update: jest.fn().mockImplementation(async ({ data }) => {
                    updates.push(data);
                    return { id: 1, ...data };
                }),
            },
        };

        const n = await refreshReal([1], db);
        expect(n).toBe(1);
        expect(updates[0]).toEqual({
            target_reporting_date: null,
            target_mep_date: null,
        });
    });

    it("recomputes normal target dates when amount is positive", async () => {
        const updates: Array<Record<string, unknown>> = [];
        const db = {
            invoice: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 2,
                        amount: 250,
                        invoice_date: new Date("2025-01-01"),
                        due_date: new Date("2025-01-10"),
                        target_reporting_date: null,
                        target_mep_date: null,
                        customer_id: 9,
                    },
                ]),
                update: jest.fn().mockImplementation(async ({ data }) => {
                    updates.push(data);
                    return { id: 2, ...data };
                }),
            },
        };

        const n = await refreshReal([2], db);
        expect(n).toBe(1);
        expect(
            (updates[0].target_reporting_date as Date)
                .toISOString()
                .slice(0, 10)
        ).toBe("2025-01-15");
        expect(
            (updates[0].target_mep_date as Date).toISOString().slice(0, 10)
        ).toBe("2025-01-17");
    });
});
