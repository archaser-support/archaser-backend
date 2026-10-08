import { resolveInsurancePolicySaveEffectiveDate } from "../src/credit-insurance/domain/insurancePolicySaveEffectiveDate";

const today = new Date("2026-10-07T15:30:00.000Z");

describe("resolveInsurancePolicySaveEffectiveDate", () => {
    it.each([undefined, null, "", "   "])(
        "defaults %p to today (live save)",
        (raw) => {
            expect(resolveInsurancePolicySaveEffectiveDate(raw, today)).toEqual({
                ok: true,
                effectiveDate: new Date("2026-10-07T00:00:00.000Z"),
                isFuture: false,
            });
        }
    );

    it("treats today as a live save", () => {
        expect(
            resolveInsurancePolicySaveEffectiveDate("2026-10-07", today)
        ).toEqual({
            ok: true,
            effectiveDate: new Date("2026-10-07T00:00:00.000Z"),
            isFuture: false,
        });
    });

    it("schedules a future date as pending", () => {
        expect(
            resolveInsurancePolicySaveEffectiveDate("2026-11-01", today)
        ).toEqual({
            ok: true,
            effectiveDate: new Date("2026-11-01T00:00:00.000Z"),
            isFuture: true,
        });
    });

    it("rejects past dates", () => {
        expect(
            resolveInsurancePolicySaveEffectiveDate("2026-10-06", today)
        ).toEqual({ ok: false, code: "EFFECTIVE_DATE_IN_PAST" });
    });

    it.each(["not-a-date", "2026-13-01", "2026-02-30", 20261101])(
        "rejects invalid value %p",
        (raw) => {
            expect(resolveInsurancePolicySaveEffectiveDate(raw, today)).toEqual({
                ok: false,
                code: "EFFECTIVE_DATE_INVALID",
            });
        }
    );
});
