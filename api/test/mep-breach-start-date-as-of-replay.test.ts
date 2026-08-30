/**
 * MEP breach start date gate — historical as-of replay.
 *
 * Asserts external behavior of the day-by-day replay that rebuilds customer
 * policy trend and credit dashboard snapshots: the reconstructed customer
 * overdue block, the `ctv_customer_overdue_mep` flag it overlays on ledger
 * lines, and the fact that the configured date is resolved once per run.
 */
import {
    asOfCustomerOverdueBlockAt,
    asOfTermsScopeKey,
    clearMepBreachStartDateCache,
    overlayAsOfTermsFlagsOnLines,
    type AsOfOpenInvoiceLine,
    type AsOfPolicyTermsForBreach,
} from "@archaser/credit-insurance-domain";

import {
    __resetCreditAsOfBackfillRunnersForTests,
    runCreditAsOfBackfillJob,
} from "../src/credit-insurance/domain/creditAsOfBackfillJob";

const ACCOUNT_ID = 42;
const CUSTOMER_ID = 7;
const MAX_ALLOWED_MEP = 30;

/** `@db.Date` columns come back from Prisma as UTC midnight. */
function day(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

const MEP_START = day("2025-06-01");

function ledgerLine(args: {
    invoiceId: number;
    invoiceDate: Date;
    dueDate: Date;
    amount?: number;
}): AsOfOpenInvoiceLine {
    return {
        invoiceId: args.invoiceId,
        customerId: CUSTOMER_ID,
        policyId: null,
        invoiceDate: args.invoiceDate,
        dueDate: args.dueDate,
        amount: args.amount ?? 1000,
        customerAmount: null,
        customerCurrency: "USD",
        paymentsOnOrBeforeAsOf: 0,
        paymentsCustomerOnOrBeforeAsOf: 0,
        lastPaymentDate: null,
        reportingBreach: false,
        ctvPaymentTerm: false,
        ctvCustomerOverdueMep: false,
        ctvOutdatedDcl: false,
        ctvInvoiceAfterPolicyEnd: false,
        inCapacityGap: false,
        capacityGapAmount: 0,
        actualReportingDate: null,
    };
}

/** Unpaid since 2020 — blocks every replayed day unless the gate drops it. */
const legacyLine = ledgerLine({
    invoiceId: 1,
    invoiceDate: day("2020-03-10"),
    dueDate: day("2020-04-10"),
});

const inScopeOverdueLine = ledgerLine({
    invoiceId: 2,
    invoiceDate: day("2025-07-01"),
    dueDate: day("2025-07-31"),
});

beforeEach(() => {
    jest.clearAllMocks();
    clearMepBreachStartDateCache();
    __resetCreditAsOfBackfillRunnersForTests();
});

describe("as-of overdue block replay — candidate set", () => {
    const replayDay = day("2025-09-15");

    it("drops an invoice issued before the configured date", () => {
        expect(
            asOfCustomerOverdueBlockAt(
                [legacyLine],
                replayDay,
                MAX_ALLOWED_MEP,
                MEP_START
            )
        ).toBe(false);
    });

    it("still blocks on an invoice issued after the configured date", () => {
        expect(
            asOfCustomerOverdueBlockAt(
                [legacyLine, inScopeOverdueLine],
                replayDay,
                MAX_ALLOWED_MEP,
                MEP_START
            )
        ).toBe(true);
    });

    it("keeps an invoice issued exactly on the configured date in scope", () => {
        const boundaryLine = ledgerLine({
            invoiceId: 3,
            invoiceDate: MEP_START,
            dueDate: day("2025-06-30"),
        });

        expect(
            asOfCustomerOverdueBlockAt(
                [boundaryLine],
                replayDay,
                MAX_ALLOWED_MEP,
                MEP_START
            )
        ).toBe(true);
    });

    it("replays a day entirely before the configured date without erroring", () => {
        const earlyDay = day("2021-01-01");

        expect(
            asOfCustomerOverdueBlockAt(
                [legacyLine],
                earlyDay,
                MAX_ALLOWED_MEP,
                MEP_START
            )
        ).toBe(false);
    });

    it("behaves exactly as before when no date is configured", () => {
        const ungated = asOfCustomerOverdueBlockAt(
            [legacyLine],
            replayDay,
            MAX_ALLOWED_MEP
        );

        expect(ungated).toBe(true);
        expect(
            asOfCustomerOverdueBlockAt(
                [legacyLine],
                replayDay,
                MAX_ALLOWED_MEP,
                null
            )
        ).toBe(ungated);
    });
});

describe("as-of replay overlay — ctv_customer_overdue_mep", () => {
    const replayDay = day("2025-09-15");
    const terms: AsOfPolicyTermsForBreach = {
        maxPaymentTerm: null,
        maxAllowedMep: MAX_ALLOWED_MEP,
        reportingDays: null,
    };
    const termsByScope = new Map<string, AsOfPolicyTermsForBreach>([
        [asOfTermsScopeKey(CUSTOMER_ID, null), terms],
    ]);

    function overlay(mepBreachStartDate?: Date | null): Map<number, boolean> {
        const flags = new Map<number, boolean>();
        for (const line of overlayAsOfTermsFlagsOnLines(
            [legacyLine, inScopeOverdueLine],
            replayDay,
            termsByScope,
            { mepBreachStartDate }
        )) {
            flags.set(line.invoiceId, line.ctvCustomerOverdueMep);
        }
        return flags;
    }

    it("clears the flag on a newer invoice once the legacy line is out of scope", () => {
        expect(overlay(MEP_START).get(inScopeOverdueLine.invoiceId)).toBe(false);
    });

    it("never flags the out-of-scope invoice itself", () => {
        expect(overlay(MEP_START).get(legacyLine.invoiceId)).toBe(false);
    });

    it("behaves exactly as before when no date is configured", () => {
        const ungated = overlay(null);

        expect(ungated.get(inScopeOverdueLine.invoiceId)).toBe(true);
        expect(ungated).toEqual(overlay(undefined));
    });
});

describe("replay run resolves the configured date once", () => {
    function backfillDb(mepBreachStartDate: Date | null) {
        const jobRow = {
            account_id: ACCOUNT_ID,
            status: "running",
            from_date: day("2025-08-01"),
            to_date: day("2025-08-03"),
            checkpoint_date: null,
            days_total: 3,
            days_done: 0,
            last_error: null,
            requested_by: null,
            started_at: day("2025-08-01"),
            updated_at: day("2025-08-01"),
        };
        return {
            $queryRaw: jest.fn(async () => [jobRow]),
            $executeRaw: jest.fn(async () => 1),
            billingConnector: {
                findUnique: jest.fn(async () => ({
                    mep_breach_start_date: mepBreachStartDate,
                })),
            },
        };
    }

    async function runReplay(mepBreachStartDate: Date | null) {
        const db = backfillDb(mepBreachStartDate);
        const syncCustomerPolicyTrendSnapshotForAccount = jest.fn(
            async () => undefined
        );
        const takeCreditDashboardDailySnapshotsForAccount = jest.fn(
            async () => undefined
        );

        await runCreditAsOfBackfillJob(ACCOUNT_ID, {
            dbClient: db as never,
            writers: {
                syncCustomerPolicyTrendSnapshotForAccount,
                takeCreditDashboardDailySnapshotsForAccount,
            },
            loadAsOfLines: async () => [legacyLine, inScopeOverdueLine],
        });

        return { db, syncCustomerPolicyTrendSnapshotForAccount };
    }

    it("reads the connector once and threads the date into every replayed day", async () => {
        const { db, syncCustomerPolicyTrendSnapshotForAccount } =
            await runReplay(MEP_START);

        expect(db.billingConnector.findUnique).toHaveBeenCalledTimes(1);
        expect(syncCustomerPolicyTrendSnapshotForAccount).toHaveBeenCalledTimes(3);
        for (const call of syncCustomerPolicyTrendSnapshotForAccount.mock.calls) {
            expect(call[1]).toEqual(
                expect.objectContaining({ mepBreachStartDate: MEP_START })
            );
        }
    });

    it("threads no gate for an account with no configured date", async () => {
        const { syncCustomerPolicyTrendSnapshotForAccount } =
            await runReplay(null);

        for (const call of syncCustomerPolicyTrendSnapshotForAccount.mock.calls) {
            expect(call[1]).toEqual(
                expect.objectContaining({ mepBreachStartDate: null })
            );
        }
    });
});
