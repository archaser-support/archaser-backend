import type { PrismaClient } from "@prisma/client";

import {
    beginCronFrozenAccountGuard,
    type CronFrozenAccountGuard,
} from "../src/accountFreeze/cronFrozenAccountGuard";
import { handleOverdueInvoices } from "../src/handleOverdueInvoices";

jest.mock("@archaser/credit-insurance-domain", () => ({
    bindCreditInsurancePrisma: jest.fn(),
    sweepReportingBreachForOverdueInvoiceIds: jest
        .fn()
        .mockResolvedValue(0),
    syncCustomerInsuranceFields: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/customersDomain", () => ({
    recalculateCustomerAmountsViaApi: jest.fn().mockResolvedValue(undefined),
    calculateOutstandingAmountsForCustomersViaApi: jest
        .fn()
        .mockResolvedValue(new Map()),
}));

const ACCOUNT_FROZEN = 101;
const ACCOUNT_CONTROL = 202;
const CUSTOMER_FROZEN = 1001;
const CUSTOMER_CONTROL = 2002;
const INVOICE_FROZEN = 11;
const INVOICE_CONTROL = 22;

function pastDueInvoice(
    id: number,
    accountId: number,
    customerId: number
) {
    return {
        id,
        customer_id: customerId,
        account_id: accountId,
        due_date: new Date("2020-01-01"),
        amount: 100,
        customer_outstanding_debt: 100,
        status: "Due",
    };
}

function createPrismaMock(options?: {
    frozenImportAccountIds?: number[];
}) {
    const invoices = [
        pastDueInvoice(INVOICE_FROZEN, ACCOUNT_FROZEN, CUSTOMER_FROZEN),
        pastDueInvoice(INVOICE_CONTROL, ACCOUNT_CONTROL, CUSTOMER_CONTROL),
    ];
    const updatedInvoiceIds: number[] = [];

    const prisma = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
            const sql = strings.join(" ");
            if (sql.includes('"ImportJob"')) {
                return (options?.frozenImportAccountIds ?? []).map(
                    (account_id) => ({ account_id })
                );
            }
            if (sql.includes('"CreditAsOfBackfillJob"')) {
                return [];
            }
            return [];
        }),
        invoice: {
            findMany: jest.fn(async (args?: { where?: { id?: { in?: number[] } } }) => {
                if (args?.where?.id?.in) {
                    return invoices.filter((row) =>
                        args.where!.id!.in!.includes(row.id)
                    );
                }
                return invoices.filter((row) => row.status === "Due");
            }),
            updateMany: jest.fn(async (args: { where: { id: { in: number[] } } }) => {
                updatedInvoiceIds.push(...args.where.id.in);
                for (const id of args.where.id.in) {
                    const row = invoices.find((invoice) => invoice.id === id);
                    if (row) {
                        row.status = "Overdue";
                    }
                }
                return { count: args.where.id.in.length };
            }),
        },
        customerCollectionPeriod: {
            findMany: jest.fn(async () => []),
        },
        customer: {
            findMany: jest.fn(async () => []),
        },
    };

    return {
        prisma: prisma as unknown as PrismaClient,
        invoices,
        updatedInvoiceIds,
    };
}

async function buildFreezeGuard(
    prisma: PrismaClient,
    frozenImportAccountIds: number[]
): Promise<CronFrozenAccountGuard> {
    return beginCronFrozenAccountGuard(
        prisma,
        "Process Overdue Invoices",
        {
            listRunningSyncAccountIds: async () => [],
            frozenImportAccountIds,
        }
    );
}

describe("handleOverdueInvoices frozen-account skip", () => {
    const originalMongoUri = process.env.MONGODB_URI;

    beforeEach(() => {
        delete process.env.MONGODB_URI;
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (originalMongoUri === undefined) {
            delete process.env.MONGODB_URI;
        } else {
            process.env.MONGODB_URI = originalMongoUri;
        }
    });

    it("skips frozen account invoices while updating control account on the same run", async () => {
        const { prisma, invoices, updatedInvoiceIds } = createPrismaMock({
            frozenImportAccountIds: [ACCOUNT_FROZEN],
        });
        const freeze = await buildFreezeGuard(prisma, [ACCOUNT_FROZEN]);

        const result = await handleOverdueInvoices(prisma, undefined, freeze);

        expect(result.success).toBe(true);
        expect(updatedInvoiceIds).toEqual([INVOICE_CONTROL]);
        expect(invoices.find((row) => row.id === INVOICE_FROZEN)?.status).toBe(
            "Due"
        );
        expect(invoices.find((row) => row.id === INVOICE_CONTROL)?.status).toBe(
            "Overdue"
        );
    });

    it("processes previously frozen account after import completes", async () => {
        const frozenRun = createPrismaMock({
            frozenImportAccountIds: [ACCOUNT_FROZEN],
        });
        const frozenGuard = await buildFreezeGuard(
            frozenRun.prisma,
            [ACCOUNT_FROZEN]
        );
        await handleOverdueInvoices(
            frozenRun.prisma,
            undefined,
            frozenGuard
        );
        expect(frozenRun.updatedInvoiceIds).toEqual([INVOICE_CONTROL]);

        const unfrozenRun = createPrismaMock({
            frozenImportAccountIds: [],
        });
        const unfrozenGuard = await buildFreezeGuard(unfrozenRun.prisma, []);
        await handleOverdueInvoices(
            unfrozenRun.prisma,
            undefined,
            unfrozenGuard
        );

        expect(unfrozenRun.updatedInvoiceIds.sort((a, b) => a - b)).toEqual(
            [INVOICE_CONTROL, INVOICE_FROZEN].sort((a, b) => a - b)
        );
        expect(
            unfrozenRun.invoices.find((row) => row.id === INVOICE_FROZEN)
                ?.status
        ).toBe("Overdue");
    });
});
