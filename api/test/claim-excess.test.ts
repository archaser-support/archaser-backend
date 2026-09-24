import {
    applyClaimExcess,
    remainingExcessForPolicyYear,
    shouldApplyExcessOnTransition,
    shouldReverseExcessOnTransition,
} from "../src/credit-insurance/domain/claims/claimExcess";

describe("applyClaimExcess", () => {
    it("deducts SDL remaining first, then Aggregate", () => {
        const applied = applyClaimExcess({
            recognizedLoss: 15000,
            commercial: { sdlExcess: 10000, aggregateExcess: 50000 },
            alreadyAppliedSdl: 0,
            alreadyAppliedAggregate: 0,
        });
        expect(applied).toEqual({
            appliedSdl: 10000,
            appliedAggregate: 5000,
        });
    });

    it("uses remaining SDL after prior claims in the same year", () => {
        const applied = applyClaimExcess({
            recognizedLoss: 8000,
            commercial: { sdlExcess: 10000, aggregateExcess: 50000 },
            alreadyAppliedSdl: 7000,
            alreadyAppliedAggregate: 0,
        });
        expect(applied).toEqual({
            appliedSdl: 3000,
            appliedAggregate: 5000,
        });
    });

    it("skips null SDL and null Aggregate buckets", () => {
        expect(
            applyClaimExcess({
                recognizedLoss: 5000,
                commercial: { sdlExcess: null, aggregateExcess: null },
                alreadyAppliedSdl: 0,
                alreadyAppliedAggregate: 0,
            })
        ).toEqual({ appliedSdl: 0, appliedAggregate: 0 });
    });

    it("treats Aggregate zero as no aggregate pot", () => {
        const applied = applyClaimExcess({
            recognizedLoss: 5000,
            commercial: { sdlExcess: 1000, aggregateExcess: 0 },
            alreadyAppliedSdl: 0,
            alreadyAppliedAggregate: 0,
        });
        expect(applied).toEqual({
            appliedSdl: 1000,
            appliedAggregate: 0,
        });
    });
});

describe("remainingExcessForPolicyYear", () => {
    it("subtracts applied sums from commercial terms", () => {
        expect(
            remainingExcessForPolicyYear({
                commercial: { sdlExcess: 10000, aggregateExcess: 50000 },
                appliedSdlSum: 4000,
                appliedAggregateSum: 12000,
            })
        ).toEqual({
            remainingSdl: 6000,
            remainingAggregate: 38000,
        });
    });

    it("keeps Aggregate zero as zero remaining", () => {
        expect(
            remainingExcessForPolicyYear({
                commercial: { sdlExcess: null, aggregateExcess: 0 },
                appliedSdlSum: 0,
                appliedAggregateSum: 0,
            })
        ).toEqual({
            remainingSdl: null,
            remainingAggregate: 0,
        });
    });
});

describe("excess transition guards", () => {
    it("applies on first entry to Approved or Paid only", () => {
        expect(shouldApplyExcessOnTransition("Draft", "Approved", false)).toBe(
            true
        );
        expect(shouldApplyExcessOnTransition("Submitted", "Paid", false)).toBe(
            true
        );
        expect(
            shouldApplyExcessOnTransition("Approved", "Paid", true)
        ).toBe(false);
        expect(
            shouldApplyExcessOnTransition("Draft", "Submitted", false)
        ).toBe(false);
    });

    it("reverses when leaving Approved/Paid", () => {
        expect(
            shouldReverseExcessOnTransition("Approved", "Canceled", true)
        ).toBe(true);
        expect(
            shouldReverseExcessOnTransition("Paid", "Rejected", true)
        ).toBe(true);
        expect(
            shouldReverseExcessOnTransition("Approved", "Paid", true)
        ).toBe(false);
        expect(
            shouldReverseExcessOnTransition("Draft", "Canceled", false)
        ).toBe(false);
    });
});
