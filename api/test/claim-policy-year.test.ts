import {
    listPolicyAnniversaryYears,
    resolvePolicyAnniversaryYear,
} from "../src/credit-insurance/domain/claims/policyAnniversaryYear";

describe("resolvePolicyAnniversaryYear", () => {
    it("places a date in year 1 from policy start", () => {
        const result = resolvePolicyAnniversaryYear({
            policyStartDate: "2024-01-15",
            policyEndDate: "2026-01-14",
            asOfDate: "2024-06-01",
        });
        expect(result).toMatchObject({
            yearIndex: 1,
            yearStart: new Date(2024, 0, 15),
            yearEnd: new Date(2025, 0, 14),
        });
    });

    it("places a date in year 2 on the anniversary boundary", () => {
        const result = resolvePolicyAnniversaryYear({
            policyStartDate: "2024-01-15",
            policyEndDate: "2027-01-14",
            asOfDate: "2025-01-15",
        });
        expect(result?.yearIndex).toBe(2);
        expect(result?.yearStart).toEqual(new Date(2025, 0, 15));
        expect(result?.yearEnd).toEqual(new Date(2026, 0, 14));
    });

    it("clips the last year to policy end_date", () => {
        const result = resolvePolicyAnniversaryYear({
            policyStartDate: "2024-01-15",
            policyEndDate: "2025-06-30",
            asOfDate: "2025-03-01",
        });
        expect(result?.yearIndex).toBe(2);
        expect(result?.yearEnd).toEqual(new Date(2025, 5, 30));
    });

    it("returns null outside the policy term", () => {
        expect(
            resolvePolicyAnniversaryYear({
                policyStartDate: "2024-01-15",
                policyEndDate: "2025-01-14",
                asOfDate: "2023-12-31",
            })
        ).toBeNull();
        expect(
            resolvePolicyAnniversaryYear({
                policyStartDate: "2024-01-15",
                policyEndDate: "2025-01-14",
                asOfDate: "2025-01-15",
            })
        ).toBeNull();
    });
});

describe("listPolicyAnniversaryYears", () => {
    it("lists anniversary years clipped by end_date", () => {
        const years = listPolicyAnniversaryYears({
            policyStartDate: "2024-01-15",
            policyEndDate: "2025-06-30",
        });
        expect(years.map((y) => y.yearIndex)).toEqual([1, 2]);
        expect(years[1].yearEnd).toEqual(new Date(2025, 5, 30));
    });
});
