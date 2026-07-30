import {
    areBackfillOptionsLocked,
    formatBackfillStartDateForApi,
    normalizeBackfillStartDateInput,
    resolveBackfillStartDateChange,
    resolveIncludeOlderOpenInvoicesChange,
    resolveSkipReportingBreachOnBackfillChange,
} from "../src/accounts-nested/billing-connector-backfill-options";

describe("Nest billing-connector backfill options parity", () => {
    it("formats and normalizes YYYY-MM-DD start dates", () => {
        expect(
            formatBackfillStartDateForApi(new Date(Date.UTC(2024, 0, 15)))
        ).toBe("2024-01-15");
        expect(formatBackfillStartDateForApi(null)).toBeNull();

        expect(normalizeBackfillStartDateInput(undefined)).toBeUndefined();
        expect(normalizeBackfillStartDateInput(null)).toBeNull();
        expect(normalizeBackfillStartDateInput("")).toBeNull();
        expect(normalizeBackfillStartDateInput("2024-06-01")).toEqual(
            new Date(Date.UTC(2024, 5, 1))
        );
        expect(() => normalizeBackfillStartDateInput("06/01/2024")).toThrow(
            /YYYY-MM-DD/
        );
    });

    it("locks cutover options after backfill_started_at", () => {
        expect(areBackfillOptionsLocked(null)).toBe(false);
        expect(areBackfillOptionsLocked(new Date())).toBe(true);

        const lockedAt = new Date("2026-07-01T12:00:00.000Z");
        const existing = new Date(Date.UTC(2024, 0, 1));

        expect(
            resolveBackfillStartDateChange({
                backfillStartedAt: lockedAt,
                existingStartDate: existing,
                nextInput: "2024-02-01",
            }).ok
        ).toBe(false);

        expect(
            resolveBackfillStartDateChange({
                backfillStartedAt: lockedAt,
                existingStartDate: existing,
                nextInput: "2024-01-01",
            })
        ).toEqual({ ok: true, value: existing });

        expect(
            resolveIncludeOlderOpenInvoicesChange({
                backfillStartedAt: lockedAt,
                existingValue: true,
                nextInput: false,
            }).ok
        ).toBe(false);

        expect(
            resolveSkipReportingBreachOnBackfillChange({
                backfillStartedAt: lockedAt,
                existingValue: false,
                nextInput: true,
            }).ok
        ).toBe(false);
    });

    it("allows cutover mutations before backfill starts and defaults match monolith", () => {
        const unlocked = resolveBackfillStartDateChange({
            backfillStartedAt: null,
            existingStartDate: null,
            nextInput: "2025-03-10",
        });
        expect(unlocked).toEqual({
            ok: true,
            value: new Date(Date.UTC(2025, 2, 10)),
        });

        expect(
            resolveIncludeOlderOpenInvoicesChange({
                backfillStartedAt: null,
                existingValue: undefined,
                nextInput: undefined,
            })
        ).toEqual({ ok: true, value: undefined });

        expect(
            resolveIncludeOlderOpenInvoicesChange({
                backfillStartedAt: null,
                existingValue: undefined,
                nextInput: true,
            })
        ).toEqual({ ok: true, value: true });

        expect(
            resolveSkipReportingBreachOnBackfillChange({
                backfillStartedAt: null,
                existingValue: undefined,
                nextInput: false,
            })
        ).toEqual({ ok: true, value: false });
    });
});
