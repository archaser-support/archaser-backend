import { CustomersService } from "../src/customers/customers.service";
import type { AccessScopeService } from "../src/auth/access-scope.service";
import type { DatabaseService } from "../src/database/database.service";
import type { JwtPayload } from "../src/auth/auth.service";

/**
 * The customer header's Total AR card reads `customer.total_ar`, which is derived
 * rather than stored — live open Due/Overdue receivables in account currency, with
 * the denormalized due + overdue rollups as fallback. When `getById` omits it the
 * card renders 0 even though the overdue and due cards beside it show real money.
 */
const ACCOUNT_ID = 42;
const CUSTOMER_ID = 1666;

type CustomerOverrides = Record<string, unknown>;

function buildService(
    customerOverrides: CustomerOverrides = {},
    openInvoices: unknown[] = []
) {
    const customerRow = {
        id: CUSTOMER_ID,
        account_id: ACCOUNT_ID,
        total_due_amount: 600,
        total_overdue_amount: 6000,
        CustomerPolicy: [],
        ...customerOverrides,
    };

    const db = {
        customer: {
            findUnique: jest.fn().mockResolvedValue({
                id: CUSTOMER_ID,
                account_id: ACCOUNT_ID,
                owner_id: null,
                business_unit_id: null,
            }),
            findFirst: jest.fn().mockResolvedValue(customerRow),
        },
        account: {
            findUnique: jest.fn().mockResolvedValue({ currency: "ILS" }),
        },
        invoice: { findMany: jest.fn().mockResolvedValue(openInvoices) },
        currencyRate: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as DatabaseService;

    const accessScope = {
        resolveUserInfo: jest
            .fn()
            .mockResolvedValue({ accountId: ACCOUNT_ID, role: "Admin" }),
        getEffectiveAccountId: jest.fn().mockReturnValue(ACCOUNT_ID),
        isAdminAccount: jest.fn().mockReturnValue(true),
        hasPermission: jest.fn().mockResolvedValue(true),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
    } as unknown as AccessScopeService;

    return new CustomersService(db, accessScope);
}

const user = { sub: "user-1" } as unknown as JwtPayload;

async function getCustomer(service: CustomersService) {
    return (await service.getById(user, CUSTOMER_ID)) as Record<
        string,
        unknown
    >;
}

describe("CustomersService.getById header Total AR", () => {
    it("falls back to due + overdue rollups when no live invoices are found", async () => {
        const result = await getCustomer(buildService());

        expect(result.total_ar).toBe(6600);
    });

    it("prefers live open receivables in account currency", async () => {
        const service = buildService({}, [
            {
                customer_id: CUSTOMER_ID,
                outstanding_debt: 4000,
                customer_currency: "ILS",
                amount: 4000,
            },
            {
                customer_id: CUSTOMER_ID,
                outstanding_debt: 1500,
                customer_currency: "ILS",
                amount: 1500,
            },
        ]);

        const result = await getCustomer(service);

        expect(result.total_ar).toBe(5500);
    });

    it("reports zero AR only when due and overdue are both zero", async () => {
        const service = buildService({
            total_due_amount: 0,
            total_overdue_amount: 0,
        });

        const result = await getCustomer(service);

        expect(result.total_ar).toBe(0);
    });

    it("always publishes the dual-currency companion keys", async () => {
        const result = await getCustomer(buildService());

        expect(result).toHaveProperty("total_ar_secondary");
        expect(result).toHaveProperty("credit_insurance_secondary_currency");
    });

    it("strips derived AR keys before writing an update", async () => {
        const service = buildService();
        const update = jest.fn().mockResolvedValue({ id: CUSTOMER_ID });
        (service as unknown as { db: { customer: { update: unknown } } }).db.customer.update =
            update;

        await service.update(user, CUSTOMER_ID, {
            customer_number: "5402",
            total_ar: 6600,
            total_ar_secondary: null,
            credit_insurance_secondary_currency: null,
        });

        const data = update.mock.calls[0][0].data;
        expect(data).not.toHaveProperty("total_ar");
        expect(data).not.toHaveProperty("total_ar_secondary");
        expect(data).not.toHaveProperty("credit_insurance_secondary_currency");
    });
});
