/**
 * MEP breach start date gate — live paths.
 *
 * Asserts external behavior: the customer overdue block written by the live
 * recompute (cause side) and the `ctv_customer_overdue_mep` flag produced by the
 * created-terms-violation snapshot (flag side), for a given configured date.
 */
import {
    clearMepBreachStartDateCache,
    computeCreatedTermsViolationSnapshot,
    isInvoiceInMepBreachScope,
    resolveCreatedOverdueMepByInvoiceId,
    resolveMepBreachStartDate,
    syncCustomerInsuranceFields,
} from "@archaser/credit-insurance-domain";

const ACCOUNT_ID = 42;
const CUSTOMER_ID = 7;

/** `@db.Date` columns come back from Prisma as UTC midnight. */
function day(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

type OverdueInvoiceFixture = {
    id: number;
    invoice_date: Date;
    due_date: Date | null;
    amount: number | null;
};

type CustomerSyncFake = {
    db: Record<string, unknown>;
    customerUpdates: Array<Record<string, unknown>>;
    connectorReads: number;
};

/**
 * Minimal stand-in for the slice of Prisma that `syncCustomerInsuranceFields`
 * touches. `invoice.findMany` serves the MEP query and the zero-limit-alert
 * query, told apart by the selected fields.
 */
function customerSyncFake(args: {
    invoices: OverdueInvoiceFixture[];
    mepBreachStartDate: Date | null;
    hasConnector?: boolean;
    maxAllowedMep?: number | null;
    previousOverdueBlock?: boolean;
}): CustomerSyncFake {
    const customerUpdates: Array<Record<string, unknown>> = [];
    let connectorReads = 0;

    const db = {
        invoice: {
            findMany: jest.fn(async (query: { select: Record<string, true> }) => {
                if (query.select.due_date) {
                    return args.invoices.map((invoice) => ({
                        due_date: invoice.due_date,
                        amount: invoice.amount,
                        invoice_date: invoice.invoice_date,
                    }));
                }
                return [];
            }),
            updateMany: jest.fn(async () => ({ count: 0 })),
        },
        customer: {
            findUnique: jest.fn(async () => ({
                overdue_block: args.previousOverdueBlock ?? false,
                account_id: ACCOUNT_ID,
            })),
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
                customerUpdates.push(data);
                return { id: CUSTOMER_ID };
            }),
        },
        customerPolicy: {
            findFirst: jest.fn(async () => ({
                id: 900,
                limit_type: null,
                credit_score: null,
                credit_score_input_date: null,
                active_customer_since: null,
                approved_limit: null,
                approved_limit_expiration_date: null,
                zero_limit_date: null,
                max_allowed_mep: args.maxAllowedMep ?? 30,
                approved_limit_currency: null,
                InsurancePolicy: null,
            })),
            update: jest.fn(async () => ({ id: 900 })),
        },
        billingConnector: {
            findUnique: jest.fn(async () => {
                connectorReads += 1;
                return args.hasConnector === false
                    ? null
                    : { mep_breach_start_date: args.mepBreachStartDate };
            }),
        },
    };

    return {
        db,
        customerUpdates,
        get connectorReads() {
            return connectorReads;
        },
    };
}

async function runCustomerSync(fake: CustomerSyncFake): Promise<{
    overdueBlock: boolean;
    oldestInvoiceOverdueDate: Date | null;
}> {
    await syncCustomerInsuranceFields(CUSTOMER_ID, {
        dbClient: fake.db as never,
        // Wall-clock "today" must be far past the MEP deadline of the fixtures.
        asOfDate: day("2026-01-01"),
    });
    const written = fake.customerUpdates.find(
        (data) => "overdue_block" in data
    ) as { overdue_block: boolean; oldest_invoice_overdue_date: Date | null };
    return {
        overdueBlock: written.overdue_block,
        oldestInvoiceOverdueDate: written.oldest_invoice_overdue_date,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    clearMepBreachStartDateCache();
});

describe("isInvoiceInMepBreachScope", () => {
    it("treats every invoice as in scope when no date is configured", () => {
        expect(isInvoiceInMepBreachScope(day("2019-01-01"), null)).toBe(true);
        expect(isInvoiceInMepBreachScope(day("2019-01-01"), undefined)).toBe(
            true
        );
    });

    it("excludes invoices issued before the configured date", () => {
        expect(
            isInvoiceInMepBreachScope(day("2025-05-31"), day("2025-06-01"))
        ).toBe(false);
    });

    it("includes an invoice issued exactly on the configured date", () => {
        expect(
            isInvoiceInMepBreachScope(day("2025-06-01"), day("2025-06-01"))
        ).toBe(true);
    });

    it("includes invoices issued after the configured date", () => {
        expect(
            isInvoiceInMepBreachScope(day("2025-06-02"), day("2025-06-01"))
        ).toBe(true);
    });
});

describe("cause side — customer overdue block", () => {
    const legacyOverdue: OverdueInvoiceFixture = {
        id: 1,
        invoice_date: day("2020-03-10"),
        due_date: day("2020-04-10"),
        amount: 5000,
    };

    it("ignores a pre-date unpaid overdue invoice, so the customer is not blocked", async () => {
        const fake = customerSyncFake({
            invoices: [legacyOverdue],
            mepBreachStartDate: day("2025-06-01"),
            previousOverdueBlock: true,
        });

        const result = await runCustomerSync(fake);

        expect(result.overdueBlock).toBe(false);
        // Aging is not gated: the stored date still reports the real oldest
        // overdue line so days-overdue keeps counting for a pre-cutover invoice.
        expect(result.oldestInvoiceOverdueDate).toEqual(day("2020-04-10"));
    });

    it("still blocks on an overdue invoice issued after the configured date", async () => {
        const fake = customerSyncFake({
            invoices: [
                legacyOverdue,
                {
                    id: 2,
                    invoice_date: day("2025-07-01"),
                    due_date: day("2025-07-31"),
                    amount: 900,
                },
            ],
            mepBreachStartDate: day("2025-06-01"),
        });

        const result = await runCustomerSync(fake);

        expect(result.overdueBlock).toBe(true);
        // The legacy line is gone from the block candidate set, but it is still
        // the customer's oldest overdue line for aging purposes.
        expect(result.oldestInvoiceOverdueDate).toEqual(day("2020-04-10"));
    });

    it("keeps an invoice issued exactly on the configured date in the candidate set", async () => {
        const fake = customerSyncFake({
            invoices: [
                {
                    id: 3,
                    invoice_date: day("2025-06-01"),
                    due_date: day("2025-06-30"),
                    amount: 400,
                },
            ],
            mepBreachStartDate: day("2025-06-01"),
        });

        const result = await runCustomerSync(fake);

        expect(result.overdueBlock).toBe(true);
        expect(result.oldestInvoiceOverdueDate).toEqual(day("2025-06-30"));
    });

    it("behaves exactly as before when no date is configured", async () => {
        const fake = customerSyncFake({
            invoices: [legacyOverdue],
            mepBreachStartDate: null,
        });

        const result = await runCustomerSync(fake);

        expect(result.overdueBlock).toBe(true);
        expect(result.oldestInvoiceOverdueDate).toEqual(day("2020-04-10"));
    });

    it("behaves exactly as before when the account has no connector", async () => {
        const fake = customerSyncFake({
            invoices: [legacyOverdue],
            mepBreachStartDate: null,
            hasConnector: false,
        });

        const result = await runCustomerSync(fake);

        expect(result.overdueBlock).toBe(true);
        expect(result.oldestInvoiceOverdueDate).toEqual(day("2020-04-10"));
    });
});

describe("flag side — created-terms-violation snapshot", () => {
    it("never sets the flag on an invoice issued before the configured date", () => {
        const snapshot = computeCreatedTermsViolationSnapshot({
            invoice_date: day("2025-05-31"),
            invoice_amount: 100,
            customer_overdue_mep_at_invoice_date: true,
            mep_breach_start_date: day("2025-06-01"),
            customer: { overdue_block: true },
            policy: null,
        });

        expect(snapshot.ctv_customer_overdue_mep).toBe(false);
    });

    it("sets the flag on an invoice issued exactly on the configured date", () => {
        const snapshot = computeCreatedTermsViolationSnapshot({
            invoice_date: day("2025-06-01"),
            invoice_amount: 100,
            customer_overdue_mep_at_invoice_date: true,
            mep_breach_start_date: day("2025-06-01"),
            customer: { overdue_block: true },
            policy: null,
        });

        expect(snapshot.ctv_customer_overdue_mep).toBe(true);
    });

    it("does not fall back to the live overdue_block column for a pre-date invoice", () => {
        const snapshot = computeCreatedTermsViolationSnapshot({
            invoice_date: day("2020-01-01"),
            invoice_amount: 100,
            mep_breach_start_date: day("2025-06-01"),
            customer: { overdue_block: true },
            policy: null,
        });

        expect(snapshot.ctv_customer_overdue_mep).toBe(false);
    });

    it("leaves the other created-terms-violation flags untouched", () => {
        const gated = computeCreatedTermsViolationSnapshot({
            invoice_date: day("2020-01-01"),
            invoice_amount: 100,
            customer_overdue_mep_at_invoice_date: true,
            mep_breach_start_date: day("2025-06-01"),
            customer: {
                overdue_block: true,
                policy_exclusion_reason: "Excluded",
            },
            policy: {
                end_date: day("2019-12-31"),
                score_validity_period_months: null,
            },
        });

        expect(gated.ctv_customer_excluded_from_policy).toBe(true);
        expect(gated.ctv_invoice_after_policy_end).toBe(true);
    });

    it("behaves exactly as before when no date is configured", () => {
        const snapshot = computeCreatedTermsViolationSnapshot({
            invoice_date: day("2020-01-01"),
            invoice_amount: 100,
            customer_overdue_mep_at_invoice_date: true,
            customer: { overdue_block: true },
            policy: null,
        });

        expect(snapshot.ctv_customer_overdue_mep).toBe(true);
    });
});

describe("flag side — resolveCreatedOverdueMepByInvoiceId", () => {
    /**
     * Ledger fake: `loadAsOfOpenInvoiceCandidates` reads via `$queryRaw`, so the
     * fixture is returned in that query's row shape.
     */
    function ledgerDb(
        rows: Array<{
            invoice_id: number;
            invoice_date: Date;
            due_date: Date;
            amount: number;
        }>
    ) {
        return {
            $queryRaw: jest.fn(async () =>
                rows.map((row) => ({
                    invoice_id: row.invoice_id,
                    customer_id: CUSTOMER_ID,
                    policy_id: null,
                    invoice_date: row.invoice_date,
                    due_date: row.due_date,
                    amount: row.amount,
                    customer_amount: null,
                    customer_currency: "USD",
                    paid_amount: 0,
                    paid_customer_amount: 0,
                    reporting_breach: false,
                    ctv_payment_term: false,
                    ctv_customer_overdue_mep: false,
                    ctv_outdated_dcl: false,
                    ctv_invoice_after_policy_end: false,
                    in_capacity_gap: false,
                    capacity_gap_amount: 0,
                    actual_reporting_date: null,
                    last_payment_date: null,
                    status: "Overdue",
                }))
            ),
        };
    }

    const legacyLine = {
        invoice_id: 1,
        invoice_date: day("2020-03-10"),
        due_date: day("2020-04-10"),
        amount: 5000,
    };

    it("drops the pre-date legacy line from the candidate ledger, clearing newer invoices", async () => {
        const newInvoice = {
            id: 2,
            invoice_date: day("2025-07-01"),
            amount: 900,
        };
        const db = ledgerDb([
            legacyLine,
            {
                invoice_id: 2,
                invoice_date: newInvoice.invoice_date,
                due_date: day("2025-08-01"),
                amount: 900,
            },
        ]);

        const flags = await resolveCreatedOverdueMepByInvoiceId({
            accountId: ACCOUNT_ID,
            customerId: CUSTOMER_ID,
            invoices: [newInvoice],
            maxAllowedMep: 30,
            mepBreachStartDate: day("2025-06-01"),
            db: db as never,
        });

        expect(flags.get(2)).toBe(false);
    });

    it("keeps flagging when the blocking line is itself in scope", async () => {
        const db = ledgerDb([
            {
                invoice_id: 5,
                invoice_date: day("2025-06-01"),
                due_date: day("2025-06-05"),
                amount: 100,
            },
            {
                invoice_id: 6,
                invoice_date: day("2025-09-01"),
                due_date: day("2025-10-01"),
                amount: 200,
            },
        ]);

        const flags = await resolveCreatedOverdueMepByInvoiceId({
            accountId: ACCOUNT_ID,
            customerId: CUSTOMER_ID,
            invoices: [{ id: 6, invoice_date: day("2025-09-01"), amount: 200 }],
            maxAllowedMep: 30,
            mepBreachStartDate: day("2025-06-01"),
            db: db as never,
        });

        expect(flags.get(6)).toBe(true);
    });

    it("never flags an out-of-scope invoice and skips the ledger read entirely", async () => {
        const db = ledgerDb([legacyLine]);

        const flags = await resolveCreatedOverdueMepByInvoiceId({
            accountId: ACCOUNT_ID,
            customerId: CUSTOMER_ID,
            invoices: [{ id: 1, invoice_date: day("2020-03-10"), amount: 5000 }],
            maxAllowedMep: 30,
            mepBreachStartDate: day("2025-06-01"),
            db: db as never,
        });

        expect(flags.get(1)).toBe(false);
        expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it("behaves exactly as before when no date is configured", async () => {
        const db = ledgerDb([
            legacyLine,
            {
                invoice_id: 2,
                invoice_date: day("2025-07-01"),
                due_date: day("2025-08-01"),
                amount: 900,
            },
        ]);

        const flags = await resolveCreatedOverdueMepByInvoiceId({
            accountId: ACCOUNT_ID,
            customerId: CUSTOMER_ID,
            invoices: [{ id: 2, invoice_date: day("2025-07-01"), amount: 900 }],
            maxAllowedMep: 30,
            mepBreachStartDate: null,
            db: db as never,
        });

        expect(flags.get(2)).toBe(true);
    });
});

describe("resolveMepBreachStartDate — per-run caching", () => {
    function connectorDb(mepBreachStartDate: Date | null) {
        return {
            billingConnector: {
                findUnique: jest.fn(async () => ({
                    mep_breach_start_date: mepBreachStartDate,
                })),
            },
        };
    }

    it("reads the connector once per account, not once per call", async () => {
        const db = connectorDb(day("2025-06-01"));

        const first = await resolveMepBreachStartDate(ACCOUNT_ID, db as never);
        const second = await resolveMepBreachStartDate(ACCOUNT_ID, db as never);
        const third = await resolveMepBreachStartDate(ACCOUNT_ID, db as never);

        expect(first).toEqual(day("2025-06-01"));
        expect(second).toEqual(first);
        expect(third).toEqual(first);
        expect(db.billingConnector.findUnique).toHaveBeenCalledTimes(1);
    });

    it("caches the no-date answer too", async () => {
        const db = connectorDb(null);

        expect(await resolveMepBreachStartDate(ACCOUNT_ID, db as never)).toBeNull();
        expect(await resolveMepBreachStartDate(ACCOUNT_ID, db as never)).toBeNull();
        expect(db.billingConnector.findUnique).toHaveBeenCalledTimes(1);
    });

    it("resolves to no gate for an account with no connector row", async () => {
        const db = {
            billingConnector: { findUnique: jest.fn(async () => null) },
        };

        expect(await resolveMepBreachStartDate(ACCOUNT_ID, db as never)).toBeNull();
    });
});

describe("a single sync run resolves the gate once", () => {
    it("does not re-query the connector per invoice", async () => {
        const fake = customerSyncFake({
            invoices: [
                {
                    id: 1,
                    invoice_date: day("2020-03-10"),
                    due_date: day("2020-04-10"),
                    amount: 100,
                },
                {
                    id: 2,
                    invoice_date: day("2020-04-10"),
                    due_date: day("2020-05-10"),
                    amount: 100,
                },
                {
                    id: 3,
                    invoice_date: day("2025-07-01"),
                    due_date: day("2025-08-01"),
                    amount: 100,
                },
            ],
            mepBreachStartDate: day("2025-06-01"),
        });

        await runCustomerSync(fake);
        await runCustomerSync(fake);

        expect(fake.connectorReads).toBe(1);
    });
});
