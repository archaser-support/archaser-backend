import { PortalService } from "../src/portal/portal.service";

const uuid = "11111111-1111-1111-1111-111111111111";

function customerRow() {
    return {
        id: 5,
        account_id: 42,
        customer_uuid: uuid,
        customer_number: "C-1",
        type: "Company",
        language: "English",
        total_due_amount: 0,
        customer_due_amount1: 0,
        customer_due_currency1: "ILS",
        customer_due_amount2: null,
        customer_due_currency2: null,
        total_invoices_overdue: 0,
        number_of_overdue_invoices: 0,
        Person: null,
        Company: { name: "Acme" },
        Account: {
            id: 42,
            name: "Acme AR",
            logo: null,
            currency: "ILS",
            promise_to_pay: true,
            max_promise_to_pay_allowed_per_cycle: 2,
            sub_domain: null,
            portal_verification_enabled: true,
            primary_color: null,
            secondary_color: null,
            chart_palette_color: null,
        },
        Country: { name: "Israel" },
        State: null,
    };
}

describe("PortalService JSON the pages already read", () => {
    it("wrong-contact returns id + Account branding", async () => {
        const db = {
            customer: { findFirst: jest.fn().mockResolvedValue(customerRow()) },
        };
        const service = new PortalService(db as never);
        const result = await service.handleSuffix(uuid, "wrong-contact");
        expect(result).toEqual(
            expect.objectContaining({
                id: 5,
                Account: expect.objectContaining({ name: "Acme AR" }),
            })
        );
    });

    it("bank-details returns Account + CustomerBanks with CustomerBankAccount", async () => {
        const db = {
            customer: { findFirst: jest.fn().mockResolvedValue(customerRow()) },
            customerBanks: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 1,
                        customer_bank_account_id: 9,
                        AccountBankAccounts: {
                            id: 9,
                            bank_name: "Leumi",
                            account_number: "123",
                            Country: { iso2: "IL", name: "Israel" },
                        },
                    },
                ]),
            },
        };
        const service = new PortalService(db as never);
        const result = await service.handleSuffix(uuid, "bank-details");
        expect(result.CustomerBanks[0].CustomerBankAccount.bank_name).toBe(
            "Leumi"
        );
        expect(result.Account.name).toBe("Acme AR");
    });

    it("view-disputes maps camelCase dispute fields", async () => {
        const db = {
            customer: { findFirst: jest.fn().mockResolvedValue(customerRow()) },
            customerDispute: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 8,
                        dispute_status: "Under_Review",
                        customer_comment: "late",
                        resolution_comment: null,
                        created_at: new Date("2026-01-01"),
                        modified_at: new Date("2026-01-02"),
                        contact_first_name: null,
                        contact_last_name: null,
                        contact_email: null,
                        contact_mobile: null,
                        DisputeReason: {
                            name: "Pricing",
                            DisputeReasonLanguage: [],
                        },
                        User_CustomerDispute_owner_idToUser: {
                            name: "Ada Lovelace",
                            first_name: "Ada",
                            last_name: "Lovelace",
                        },
                        DisputeInvoice: [
                            {
                                Invoice: {
                                    id: 1,
                                    invoice_number: "INV-1",
                                    amount: 10,
                                    customer_amount: 10,
                                    due_date: new Date("2026-02-01"),
                                    total_paid: 0,
                                    customer_total_paid: 0,
                                    outstanding_debt: 10,
                                    customer_outstanding_debt: 10,
                                    status: "Overdue",
                                    customer_currency: "ILS",
                                },
                            },
                        ],
                    },
                ]),
            },
        };
        const service = new PortalService(db as never);
        const result = await service.handleSuffix(uuid, "view-disputes");
        expect(result.disputes[0]).toEqual(
            expect.objectContaining({
                id: 8,
                status: "Under_Review",
                reason: "Pricing",
                comment: "late",
                assignedUser: expect.objectContaining({ name: "Ada Lovelace" }),
            })
        );
        expect(result.disputes[0].invoices).toHaveLength(1);
        expect(result.customerName).toBe("Acme");
    });

    it("agent-portal includes invoices, reasons, and isOpenDispute", async () => {
        const db = {
            customer: { findFirst: jest.fn().mockResolvedValue(customerRow()) },
            invoice: { findMany: jest.fn().mockResolvedValue([]) },
            disputeReason: { findMany: jest.fn().mockResolvedValue([]) },
            customerDispute: { count: jest.fn().mockResolvedValue(2) },
        };
        const service = new PortalService(db as never);
        const result = await service.handleSuffix(uuid, "agent-portal");
        expect(result).toEqual(
            expect.objectContaining({
                customer_id: 5,
                invoices: [],
                reasons: [],
                isOpenDispute: true,
            })
        );
    });

    it("createPublicDispute contact type skips invoices", async () => {
        const create = jest.fn().mockResolvedValue({ id: 77 });
        const db = {
            customer: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 5,
                    account_id: 42,
                }),
            },
            customerCollectionPeriod: {
                findFirst: jest.fn().mockResolvedValue({ id: 3 }),
                update: jest.fn(),
            },
            $transaction: jest.fn(async (fn) =>
                fn({
                    customerDispute: { create },
                    activity: { create: jest.fn() },
                    customerCollectionPeriod: { update: jest.fn() },
                })
            ),
        };
        const service = new PortalService(db as never);
        const result = await service.createPublicDispute({
            customer_id: 5,
            dispute_type: "contact",
            contact_first_name: "A",
            contact_email: "a@b.com",
        });
        expect(result).toEqual({ ok: true, disputeId: 77 });
        expect(create).toHaveBeenCalled();
    });

    it("sendVerificationCode persists a code and obfuscates email", async () => {
        const db = {
            customer: { findFirst: jest.fn().mockResolvedValue(customerRow()) },
            contact: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 1, email: "agent@acme.com" }),
            },
            verificationCode: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                create: jest.fn().mockResolvedValue({ id: 1 }),
            },
        };
        const service = new PortalService(db as never);
        const result = await service.sendVerificationCode({
            customerUUID: uuid,
        });
        expect(result.success).toBe(true);
        expect(result.emailObfuscated).toBe("ag***@acme.com");
        expect(db.verificationCode.create).toHaveBeenCalled();
    });

    it("verifyCode returns valid when a live code matches", async () => {
        const db = {
            verificationCode: {
                findFirst: jest.fn().mockResolvedValue({ id: 1 }),
            },
        };
        const service = new PortalService(db as never);
        const result = await service.verifyCode({
            customerUUID: uuid,
            code: "123456",
        });
        expect(result).toEqual({ valid: true });
    });
});
