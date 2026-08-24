import { SystemService } from "../src/system/system.service";
import {
    CONTEXT_PRIMARY_TABLE,
    ENTITY_LIST_REPORT_CONTEXTS,
} from "../../reports/src/reports/report.constants";

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
        buildCustomerAccessWhere: jest.fn().mockResolvedValue([]),
        getBusinessUnitHierarchy: jest.fn().mockResolvedValue([]),
        hasPermission: jest.fn().mockResolvedValue(true),
    };
}

function db(overrides: Record<string, unknown> = {}) {
    return {
        account: {
            findUnique: jest.fn().mockResolvedValue({ currency: "ILS" }),
        },
        invoice: {
            count: jest.fn().mockResolvedValue(0),
            aggregate: jest.fn().mockResolvedValue({
                _sum: { outstanding_debt: 0, customer_outstanding_debt: 0 },
            }),
        },
        customer: {
            count: jest.fn().mockResolvedValue(0),
        },
        customerCollectionPeriod: {
            count: jest.fn().mockResolvedValue(0),
            aggregate: jest.fn().mockResolvedValue({
                _sum: { total_outstanding_amount: 0, no_of_overdue_invoices: 0 },
            }),
            findMany: jest.fn().mockResolvedValue([]),
        },
        invoicePayment: {
            count: jest.fn().mockResolvedValue(0),
            aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        },
        ...overrides,
    };
}

function service(database = db()) {
    return new SystemService(
        database as never,
        accessScope() as never,
        {} as never,
        {} as never
    );
}

describe("getChartDetails JSON for report-backed drills", () => {
    it("returns data + summary keys for an unknown chart type", async () => {
        const result = await service().getChartDetails(user(), {
            type: "not-a-chart",
            period: "2026-08",
        });
        expect(result).toEqual(
            expect.objectContaining({
                details: [],
                data: [],
                totalRecords: 0,
                summary: { totalRecords: 0, totalAmount: 0 },
                currency: "ILS",
            })
        );
    });

    it("summarizes overdue-invoices with unpaid statuses and due_date before today", async () => {
        const database = db();
        (database.invoice.count as jest.Mock).mockResolvedValue(4);
        (database.invoice.aggregate as jest.Mock).mockResolvedValue({
            _sum: { outstanding_debt: 250, customer_outstanding_debt: 0 },
        });
        const result = await service(database).getChartDetails(user(), {
            type: "overdue-invoices",
            period: "2026-08",
        });
        expect(database.invoice.count).toHaveBeenCalled();
        const where = (database.invoice.count as jest.Mock).mock.calls[0][0]
            .where;
        expect(where.status.in).toEqual(
            expect.arrayContaining(["Overdue", "Due", "Open"])
        );
        expect(where.due_date.lt).toBeInstanceOf(Date);
        expect(result.summary).toEqual({
            totalRecords: 4,
            totalAmount: 250,
        });
        expect(result.data).toEqual([]);
    });

    it("summarizes due-today as Due invoices in today's window", async () => {
        const database = db();
        (database.invoice.count as jest.Mock).mockResolvedValue(2);
        (database.invoice.aggregate as jest.Mock).mockResolvedValue({
            _sum: { outstanding_debt: 0, customer_outstanding_debt: 80 },
        });
        const result = await service(database).getChartDetails(user(), {
            type: "due-today",
            period: "2026-08",
        });
        const where = (database.invoice.count as jest.Mock).mock.calls[0][0]
            .where;
        expect(where.status).toBe("Due");
        expect(where.customer_outstanding_debt).toEqual({ gt: 0 });
        expect(where.due_date.gte).toBeInstanceOf(Date);
        expect(where.due_date.lte).toBeInstanceOf(Date);
        expect(result.summary).toEqual({
            totalRecords: 2,
            totalAmount: 80,
        });
    });

    it("puts collected-mtd payment count on summary.totalCollectedRecords", async () => {
        const database = db();
        (database.invoicePayment.count as jest.Mock).mockResolvedValue(3);
        (database.invoicePayment.aggregate as jest.Mock).mockResolvedValue({
            _sum: { amount: 900 },
        });
        const result = await service(database).getChartDetails(user(), {
            type: "collected-mtd",
            period: "2026-08",
        });
        expect(result.summary).toEqual({
            totalRecords: 3,
            totalAmount: 900,
            totalCollectedRecords: 3,
        });
    });

    it("puts active-customers entered/exited counts on summary", async () => {
        const database = db();
        (database.customer.count as jest.Mock)
            .mockResolvedValueOnce(5)
            .mockResolvedValueOnce(2);
        const result = await service(database).getChartDetails(user(), {
            type: "active-customers",
            period: "2026-08",
        });
        expect(result.summary).toEqual({
            totalRecords: 7,
            totalAmount: 0,
            enteredCount: 5,
            exitedCount: 2,
        });
    });
});

describe("customer unpaid invoices report context", () => {
    it("treats customer_unpaid_invoices as an Invoice entity-list context", () => {
        expect(CONTEXT_PRIMARY_TABLE.customer_unpaid_invoices).toBe("Invoice");
        expect(ENTITY_LIST_REPORT_CONTEXTS.has("customer_unpaid_invoices")).toBe(
            true
        );
    });
});
