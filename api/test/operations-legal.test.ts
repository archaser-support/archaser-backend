import { OperationsService } from "../src/operations/operations.service";

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
        hasPermission: jest.fn().mockResolvedValue(true),
        getOwnerFilter: jest.fn().mockResolvedValue({}),
    };
}

describe("legal-cases list JSON", () => {
    it("returns legalCases the grid reads instead of an empty stub", async () => {
        const db = {
            customerCollectionPeriod: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 12,
                        customer_id: 5,
                        total_outstanding_amount: 100,
                        currency: "ILS",
                        last_call: null,
                        last_call_result: null,
                        period_end_date: null,
                        period_start_date: new Date("2026-01-01"),
                        Customer: {
                            id: 5,
                            customer_number: "C-1",
                            oldest_invoice_overdue_date: new Date(
                                "2026-01-10"
                            ),
                            Company: { name: "Acme" },
                            Person: null,
                            Country: { name: "Israel" },
                        },
                    },
                ]),
                count: jest.fn().mockResolvedValue(1),
            },
        };
        const service = new OperationsService(
            db as never,
            accessScope() as never,
            {} as never
        );
        const result = await service.list("legal-cases", user(), {
            page: "1",
            limit: "25",
        });
        expect(result.legalCases).toHaveLength(1);
        expect(result.legalCases[0]).toEqual(
            expect.objectContaining({
                id: 12,
                customer: "Acme",
                customer_number: "C-1",
                amount_overdue: 100,
                customer_country: "Israel",
            })
        );
        expect(result.totalRecords).toBe(1);
    });
});
