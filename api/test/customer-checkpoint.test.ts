import { Prisma } from "@prisma/client";

import { CustomerCheckpointService } from "../src/customers/customer-checkpoint.service";
import { syncCustomerInsuranceFields } from "../src/credit-insurance/domain/syncCustomerInsuranceFields";
import { recalculateCustomerAmounts } from "../src/customers/domain/recalculateCustomerAmounts";
import type { AccessScopeService } from "../src/auth/access-scope.service";
import type { DatabaseService } from "../src/database/database.service";
import type { JwtPayload } from "../src/auth/auth.service";

jest.mock("../src/customers/domain/recalculateCustomerAmounts", () => ({
    recalculateCustomerAmounts: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock("../src/credit-insurance/domain/syncCustomerInsuranceFields", () => ({
    syncCustomerInsuranceFields: jest.fn().mockResolvedValue(undefined),
}));

const ACCOUNT_ID = 42;
const CUSTOMER_ID = 7;
const ACTIVITY_ID = BigInt(10);
const DISPUTE_ID = 33;

const user = { sub: "user-1" } as unknown as JwtPayload;

/** Prisma client property -> payload key, in the service's insert order. */
const TABLES: Array<[client: string, key: string]> = [
    ["contact", "contacts"],
    ["customerBanks", "customerBanks"],
    ["customerCollectionPeriod", "collectionPeriods"],
    ["invoice", "invoices"],
    ["payment", "payments"],
    ["invoicePayment", "invoicePayments"],
    ["activity", "activities"],
    ["activityContact", "activityContacts"],
    ["customerDispute", "disputes"],
    ["disputeInvoice", "disputeInvoices"],
    ["customerAggregatedData", "aggregatedData"],
    ["customerPolicy", "customerPolicies"],
    ["customerTopUp", "customerTopUps"],
];

/** One row per table, using real column names so DMMF coercion keeps them. */
const SEED_ROWS: Record<string, Record<string, unknown>> = {
    contact: { id: 1, customer_id: CUSTOMER_ID, account_id: ACCOUNT_ID },
    customerBanks: { id: 2, customer_id: CUSTOMER_ID, account_id: ACCOUNT_ID },
    customerCollectionPeriod: {
        id: 3,
        customer_id: CUSTOMER_ID,
        total_outstanding_amount: 500,
    },
    invoice: {
        id: 4,
        customer_id: CUSTOMER_ID,
        account_id: ACCOUNT_ID,
        outstanding_debt: 500,
        due_date: new Date("2026-01-15T00:00:00.000Z"),
    },
    payment: { id: 5, customer_id: CUSTOMER_ID, account_id: ACCOUNT_ID },
    invoicePayment: {
        id: 6,
        customer_id: CUSTOMER_ID,
        invoice_id: 4,
        account_id: ACCOUNT_ID,
        reference: "PAY-1",
    },
    activity: {
        id: ACTIVITY_ID,
        customer_id: CUSTOMER_ID,
        account_id: ACCOUNT_ID,
        content: "called",
        created_at: new Date("2026-02-01T10:00:00.000Z"),
    },
    activityContact: { id: 8, activity_id: ACTIVITY_ID, contact_id: 1 },
    customerDispute: { id: DISPUTE_ID, customer_id: CUSTOMER_ID },
    disputeInvoice: { id: 9, dispute_id: DISPUTE_ID, invoice_id: 4 },
    customerAggregatedData: { id: 11, customer_id: CUSTOMER_ID },
    customerPolicy: {
        id: 12,
        customer_id: CUSTOMER_ID,
        approved_limit: new Prisma.Decimal("1000.50"),
    },
    customerTopUp: {
        id: 13,
        customer_id: CUSTOMER_ID,
        insurance_policy_id: 900,
    },
};

const CUSTOMER_ROW = {
    id: CUSTOMER_ID,
    account_id: ACCOUNT_ID,
    customer_uuid: "0f2a6a2e-1111-4b2f-9c3d-000000000001",
    total_due_amount: 500,
    collection_status: "Active",
};

type Harness = ReturnType<typeof buildHarness>;

function buildHarness(
    options: {
        flagEnabled?: boolean;
        checkpoint?: { payload: unknown; saved_at: Date; saved_by: string } | null;
        customerFound?: boolean;
    } = {}
) {
    const { flagEnabled = true, checkpoint = null, customerFound = true } =
        options;

    /** Records delete/create calls so ordering can be asserted. */
    const callOrder: string[] = [];
    const delegates: Record<string, Record<string, jest.Mock>> = {};

    for (const [client] of TABLES) {
        delegates[client] = {
            findMany: jest.fn(async () => [{ ...SEED_ROWS[client] }]),
            deleteMany: jest.fn(async () => {
                callOrder.push(`delete:${client}`);
                return { count: 1 };
            }),
            createMany: jest.fn(async ({ data }: { data: unknown[] }) => {
                callOrder.push(`create:${client}`);
                return { count: data.length };
            }),
        };
    }

    const customerUpdate = jest.fn(
        async (_args: { where: Record<string, unknown>; data: any }) =>
            CUSTOMER_ROW
    );
    const upsert = jest.fn(
        async ({ create }: { create: Record<string, unknown> }) => ({
            ...create,
            saved_at: create.saved_at,
            saved_by: create.saved_by,
        })
    );

    const db = {
        ...delegates,
        customer: {
            findFirst: jest.fn(async () =>
                customerFound
                    ? {
                          account_id: ACCOUNT_ID,
                          Account: {
                              enable_customer_checkpoints: flagEnabled,
                          },
                      }
                    : null
            ),
            findUnique: jest.fn(async () => ({ ...CUSTOMER_ROW })),
            update: customerUpdate,
        },
        customerCheckpoint: {
            findUnique: jest.fn(async () => checkpoint),
            upsert,
        },
        $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
            cb(db)
        ),
    } as unknown as DatabaseService & Record<string, any>;

    const accessScope = {
        resolveUserInfo: jest
            .fn()
            .mockResolvedValue({ accountId: ACCOUNT_ID, role: "Admin" }),
        getEffectiveAccountId: jest.fn().mockReturnValue(ACCOUNT_ID),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
    } as unknown as AccessScopeService;

    return {
        service: new CustomerCheckpointService(db, accessScope),
        db,
        delegates,
        callOrder,
        customerUpdate,
        upsert,
    };
}

function capturedPayload(harness: Harness) {
    return harness.upsert.mock.calls[0][0].create.payload;
}

/** `process.env.NODE_ENV` is typed read-only, but the gate reads it at runtime. */
const mutableEnv = process.env as Record<string, string | undefined>;

describe("CustomerCheckpointService gates", () => {
    const originalEnv = mutableEnv.NODE_ENV;

    afterEach(() => {
        mutableEnv.NODE_ENV = originalEnv;
        jest.clearAllMocks();
    });

    it("refuses to save in production", async () => {
        mutableEnv.NODE_ENV = "production";
        const { service } = buildHarness();

        await expect(service.save(user, CUSTOMER_ID)).rejects.toMatchObject({
            status: 403,
        });
    });

    it("404s when the customer is outside the caller's account", async () => {
        const { service } = buildHarness({ customerFound: false });

        await expect(
            service.getStatus(user, CUSTOMER_ID)
        ).rejects.toMatchObject({ status: 404 });
    });

    it("403s when the account flag is off", async () => {
        const { service } = buildHarness({ flagEnabled: false });

        await expect(service.save(user, CUSTOMER_ID)).rejects.toMatchObject({
            status: 403,
        });
    });

    it("404s on restore when no checkpoint was saved", async () => {
        const { service } = buildHarness({ checkpoint: null });

        await expect(service.restore(user, CUSTOMER_ID)).rejects.toMatchObject({
            status: 404,
        });
    });
});

describe("CustomerCheckpointService status", () => {
    afterEach(() => jest.clearAllMocks());

    it("reports exists=false rather than throwing when nothing is saved", async () => {
        const { service } = buildHarness({ checkpoint: null });

        await expect(service.getStatus(user, CUSTOMER_ID)).resolves.toEqual({
            exists: false,
            savedAt: null,
            savedBy: null,
        });
    });

    it("returns the saved metadata and row counts", async () => {
        const savedAt = new Date("2026-03-01T12:00:00.000Z");
        const { service } = buildHarness({
            checkpoint: {
                saved_at: savedAt,
                saved_by: "user-1",
                payload: {
                    schemaVersion: 1,
                    capturedAt: savedAt.toISOString(),
                    tables: {
                        customer: {},
                        invoices: [{}, {}],
                        aggregatedData: [{}],
                    },
                },
            },
        });

        const status = await service.getStatus(user, CUSTOMER_ID);

        expect(status.exists).toBe(true);
        expect(status.savedAt).toBe(savedAt.toISOString());
        expect(status.savedBy).toBe("user-1");
        expect(status.rowCounts?.invoices).toBe(2);
        expect(status.rowCounts?.payments).toBe(0);
        expect(status.rowCounts?.hasAggregatedData).toBe(true);
    });
});

describe("CustomerCheckpointService save", () => {
    afterEach(() => jest.clearAllMocks());

    it("captures every in-scope table and serializes to JSON-safe values", async () => {
        const harness = buildHarness();

        const status = await harness.service.save(user, CUSTOMER_ID);

        const payload = capturedPayload(harness) as {
            schemaVersion: number;
            tables: Record<string, any>;
        };

        expect(payload.schemaVersion).toBe(1);
        expect(payload.tables.customer.id).toBe(CUSTOMER_ID);
        for (const [, key] of TABLES) {
            expect(payload.tables[key]).toHaveLength(1);
        }

        // BigInt, Date and Decimal must survive as JSON primitives.
        expect(payload.tables.activities[0].id).toBe("10");
        expect(payload.tables.activities[0].created_at).toBe(
            "2026-02-01T10:00:00.000Z"
        );
        expect(payload.tables.customerPolicies[0].approved_limit).toBe(
            "1000.5"
        );

        expect(status.exists).toBe(true);
        expect(status.rowCounts?.invoices).toBe(1);
        expect(status.rowCounts?.hasAggregatedData).toBe(true);
    });

    it("scopes activity-linked children by the customer's activity ids", async () => {
        const harness = buildHarness();

        await harness.service.save(user, CUSTOMER_ID);

        expect(
            harness.delegates.activityContact.findMany
        ).toHaveBeenCalledWith({
            where: { activity_id: { in: [ACTIVITY_ID] } },
        });
        expect(harness.delegates.disputeInvoice.findMany).toHaveBeenCalledWith({
            where: { dispute_id: { in: [DISPUTE_ID] } },
        });
    });
});

describe("CustomerCheckpointService restore", () => {
    afterEach(() => jest.clearAllMocks());

    /** Save first so the restore runs against a payload this service produced. */
    async function saveThenRestore() {
        const saveHarness = buildHarness();
        await saveHarness.service.save(user, CUSTOMER_ID);
        const payload = capturedPayload(saveHarness);

        const harness = buildHarness({
            checkpoint: {
                payload,
                saved_at: new Date("2026-03-01T12:00:00.000Z"),
                saved_by: "user-1",
            },
        });
        const summary = await harness.service.restore(user, CUSTOMER_ID);
        return { harness, summary };
    }

    it("deletes children before parents and re-inserts in the reverse order", async () => {
        const { harness } = await saveThenRestore();

        const deletes = harness.callOrder.filter((c) => c.startsWith("delete:"));
        const creates = harness.callOrder.filter((c) => c.startsWith("create:"));
        const insertOrder = TABLES.map(([client]) => client);

        expect(deletes).toEqual(
            [...insertOrder].reverse().map((c) => `delete:${c}`)
        );
        expect(creates).toEqual(insertOrder.map((c) => `create:${c}`));

        // Every delete must precede every insert.
        const lastDelete = harness.callOrder.lastIndexOf(
            deletes[deletes.length - 1]
        );
        const firstCreate = harness.callOrder.indexOf(creates[0]);
        expect(lastDelete).toBeLessThan(firstCreate);
    });

    it("restores rows with their original primary keys and runtime types", async () => {
        const { harness } = await saveThenRestore();

        const activityRows =
            harness.delegates.activity.createMany.mock.calls[0][0].data;
        expect(activityRows[0].id).toBe(ACTIVITY_ID);
        expect(activityRows[0].created_at).toBeInstanceOf(Date);

        const policyRows =
            harness.delegates.customerPolicy.createMany.mock.calls[0][0].data;
        expect(
            Prisma.Decimal.isDecimal(policyRows[0].approved_limit)
        ).toBe(true);
        expect(policyRows[0].approved_limit.toString()).toBe("1000.5");

        const invoiceRows =
            harness.delegates.invoice.createMany.mock.calls[0][0].data;
        expect(invoiceRows[0].id).toBe(4);
        expect(invoiceRows[0].due_date).toBeInstanceOf(Date);
    });

    it("updates the customer in place without touching its primary key", async () => {
        const { harness } = await saveThenRestore();

        expect(harness.customerUpdate).toHaveBeenCalledTimes(1);
        const call = harness.customerUpdate.mock.calls[0][0];
        expect(call.where).toEqual({ id: CUSTOMER_ID });
        expect(call.data).not.toHaveProperty("id");
        expect(call.data.customer_uuid).toBe(CUSTOMER_ROW.customer_uuid);
    });

    it("re-derives rollups and insurance fields after the transaction commits", async () => {
        const { harness, summary } = await saveThenRestore();

        expect(recalculateCustomerAmounts).toHaveBeenCalledWith(
            [CUSTOMER_ID],
            harness.db
        );
        expect(syncCustomerInsuranceFields).toHaveBeenCalledWith(CUSTOMER_ID);
        expect(summary.rowCounts.invoices).toBe(1);
        expect(summary.restoredAt).toEqual(expect.any(String));
    });
});
