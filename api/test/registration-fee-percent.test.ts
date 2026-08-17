import { parseRegistrationFeePercent } from "../src/credit-insurance/domain/registrationFeePercent";

describe("parseRegistrationFeePercent", () => {
    it("accepts Primary values from 0 through 100 and blank values", () => {
        expect(parseRegistrationFeePercent("0", "Primary")).toBe(0);
        expect(parseRegistrationFeePercent("100", "Primary")).toBe(100);
        expect(parseRegistrationFeePercent("2,5", "Primary")).toBe(2.5);
        expect(parseRegistrationFeePercent(" ", "Primary")).toBeNull();
    });

    it("rejects invalid Primary values and clears TopUp values", () => {
        expect(() => parseRegistrationFeePercent("100.01", "Primary")).toThrow(
            /between/
        );
        expect(() => parseRegistrationFeePercent("invalid", "Primary")).toThrow(
            /valid number/
        );
        expect(parseRegistrationFeePercent("25", "TopUp")).toBeNull();
    });
});
