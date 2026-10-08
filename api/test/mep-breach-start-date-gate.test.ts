/**
 * MEP breach start date gate — live paths.
 *
 * Asserts external behavior: the `ctv_customer_overdue_mep` flag produced by the
 * created-terms-violation snapshot (flag side), for a given configured date.
 */
import {
    clearMepBreachStartDateCache,
    computeCreatedTermsViolationSnapshot,
    isInvoiceInMepBreachScope,
    resolveCreatedOverdueMepByInvoiceId,
    resolveMepBreachStartDate,
} from "@archaser/credit-insurance-domain";

const ACCOUNT_ID = 42;
const CUSTOMER_ID = 7;

/** `@db.Date` columns come back from Prisma as UTC midnight. */
function day(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
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
