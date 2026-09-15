import {
    computeAnnualCreditAssessmentCost,
    computeAssessmentYearMultiplier,
    parseAnnualCreditAssessmentFee,
    sumAnnualCreditAssessmentCost,
    sumIdleNamedAnnualCreditAssessment,
    validateAnnualCreditAssessmentFeeFormField,
} from "../src/credit-insurance/domain/annualCreditAssessmentFee";

describe("computeAssessmentYearMultiplier", () => {
    it("uses max(1, ceil(inclusiveDays / 365))", () => {
        expect(computeAssessmentYearMultiplier(1)).toBe(1);
        expect(computeAssessmentYearMultiplier(365)).toBe(1);
        expect(computeAssessmentYearMultiplier(366)).toBe(2);
        expect(computeAssessmentYearMultiplier(730)).toBe(2);
        expect(computeAssessmentYearMultiplier(731)).toBe(3);
    });

    it("never returns less than 1 for non-positive or non-finite days", () => {
        expect(computeAssessmentYearMultiplier(0)).toBe(1);
        expect(computeAssessmentYearMultiplier(-10)).toBe(1);
        expect(computeAssessmentYearMultiplier(Number.NaN)).toBe(1);
    });
});

describe("computeAnnualCreditAssessmentCost", () => {
    it("multiplies fee × named customers × year multiplier", () => {
        expect(
            computeAnnualCreditAssessmentCost({
                fee: 100,
                namedCustomerCount: 3,
                yearMultiplier: 2,
            })
        ).toBe(600);
    });

    it("treats null fee as 0", () => {
        expect(
            computeAnnualCreditAssessmentCost({
                fee: null,
                namedCustomerCount: 5,
                yearMultiplier: 1,
            })
        ).toBe(0);
    });
});

describe("sumAnnualCreditAssessmentCost", () => {
    it("sums per-policy fee × named count × shared year multiplier", () => {
        expect(
            sumAnnualCreditAssessmentCost(
                [
                    { fee: 100, namedCustomerCount: 2 },
                    { fee: 50, namedCustomerCount: 4 },
                    { fee: null, namedCustomerCount: 10 },
                ],
                2
            )
        ).toEqual({
            annualCreditAssessmentCost: 800,
            namedCustomerCountInRange: 16,
            yearMultiplier: 2,
        });
    });
});

describe("sumIdleNamedAnnualCreditAssessment", () => {
    it("sums idle count, ratio vs named denominator, and fee × idle × years", () => {
        expect(
            sumIdleNamedAnnualCreditAssessment(
                [
                    { fee: 100, namedCustomerCount: 4, idleNamedCustomerCount: 1 },
                    { fee: 50, namedCustomerCount: 2, idleNamedCustomerCount: 2 },
                    {
                        fee: null,
                        namedCustomerCount: 10,
                        idleNamedCustomerCount: 3,
                    },
                ],
                2
            )
        ).toEqual({
            idleNamedCustomerCount: 6,
            namedCustomerCountInRange: 16,
            idleNamedCustomerPct: (100 * 6) / 16,
            // (100×1×2) + (50×2×2) + (0×3×2) = 200 + 200 + 0
            idleNamedAnnualCreditAssessmentCost: 400,
            yearMultiplier: 2,
        });
    });

    it("caps idle at named and returns 0% when no named customers", () => {
        expect(
            sumIdleNamedAnnualCreditAssessment(
                [{ fee: 10, namedCustomerCount: 2, idleNamedCustomerCount: 9 }],
                1
            )
        ).toMatchObject({
            idleNamedCustomerCount: 2,
            namedCustomerCountInRange: 2,
            idleNamedCustomerPct: 100,
            idleNamedAnnualCreditAssessmentCost: 20,
        });
        expect(
            sumIdleNamedAnnualCreditAssessment(
                [{ fee: 10, namedCustomerCount: 0, idleNamedCustomerCount: 0 }],
                1
            )
        ).toMatchObject({
            idleNamedCustomerCount: 0,
            namedCustomerCountInRange: 0,
            idleNamedCustomerPct: 0,
            idleNamedAnnualCreditAssessmentCost: 0,
        });
    });
});

describe("parseAnnualCreditAssessmentFee", () => {
    it("accepts blank, zero, and positive amounts on Primary", () => {
        expect(parseAnnualCreditAssessmentFee(null, "Primary")).toBeNull();
        expect(parseAnnualCreditAssessmentFee("", "Primary")).toBeNull();
        expect(parseAnnualCreditAssessmentFee(" ", "Primary")).toBeNull();
        expect(parseAnnualCreditAssessmentFee("0", "Primary")).toBe(0);
        expect(parseAnnualCreditAssessmentFee("500", "Primary")).toBe(500);
        expect(parseAnnualCreditAssessmentFee("12,5", "Primary")).toBe(12.5);
    });

    it("rejects negative and non-numeric values on Primary", () => {
        expect(() => parseAnnualCreditAssessmentFee("-0.01", "Primary")).toThrow(
            /greater than or equal to 0/
        );
        expect(() => parseAnnualCreditAssessmentFee("invalid", "Primary")).toThrow(
            /valid number/
        );
    });

    it("forces null on TopUp even when a value is provided", () => {
        expect(parseAnnualCreditAssessmentFee("25", "TopUp")).toBeNull();
        expect(parseAnnualCreditAssessmentFee(100, "TopUp")).toBeNull();
    });
});

describe("validateAnnualCreditAssessmentFeeFormField", () => {
    it("mirrors server rules without throwing", () => {
        expect(
            validateAnnualCreditAssessmentFeeFormField("", "Primary")
        ).toEqual({ value: null });
        expect(
            validateAnnualCreditAssessmentFeeFormField("500", "Primary")
        ).toEqual({ value: 500 });
        expect(
            validateAnnualCreditAssessmentFeeFormField("-1", "Primary")
        ).toEqual({ value: null, error: "negative" });
        expect(
            validateAnnualCreditAssessmentFeeFormField("abc", "Primary")
        ).toEqual({ value: null, error: "invalid_number" });
        expect(
            validateAnnualCreditAssessmentFeeFormField("50", "TopUp")
        ).toEqual({ value: null });
    });
});
