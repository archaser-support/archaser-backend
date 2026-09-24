import { defaultRecognizedLoss } from "../src/credit-insurance/domain/claims/defaultRecognizedLoss";

describe("defaultRecognizedLoss", () => {
    it("multiplies open amount by insured percentage", () => {
        expect(defaultRecognizedLoss(1000, 85)).toBe(850);
        expect(defaultRecognizedLoss(8750.5, 50)).toBe(4375.25);
    });

    it("treats null insured percentage as 100%", () => {
        expect(defaultRecognizedLoss(1000, null)).toBe(1000);
        expect(defaultRecognizedLoss(1000, undefined)).toBe(1000);
    });

    it("rejects invalid open amount or percent", () => {
        expect(() => defaultRecognizedLoss(-1, 100)).toThrow(/non-negative/);
        expect(() => defaultRecognizedLoss(100, 101)).toThrow(/between/);
    });
});
