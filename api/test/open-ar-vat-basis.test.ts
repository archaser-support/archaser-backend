import {
    applyOpenArVatBasis,
    computeOpenArVatBasisContribution,
} from "@archaser/credit-insurance-domain";

describe("computeOpenArVatBasisContribution", () => {
    it("returns full outstanding when amounts include VAT", () => {
        expect(
            computeOpenArVatBasisContribution({
                amountsIncludeVat: true,
                outstandingWithVat: 117,
                amountWithoutVat: 100,
                amountWithVat: 117,
            })
        ).toBe(117);
    });

    it("scales outstanding when exclude VAT and both amounts are present", () => {
        expect(
            computeOpenArVatBasisContribution({
                amountsIncludeVat: false,
                outstandingWithVat: 117,
                amountWithoutVat: 100,
                amountWithVat: 117,
            })
        ).toBeCloseTo(100, 10);
    });

    it("keeps credit-note sign when without-VAT is a positive magnitude", () => {
        expect(
            computeOpenArVatBasisContribution({
                amountsIncludeVat: false,
                outstandingWithVat: -117,
                amountWithoutVat: 100,
                amountWithVat: -117,
            })
        ).toBeCloseTo(-100, 10);
    });

    it("keeps credit-note sign when without-VAT matches amount sign", () => {
        expect(
            computeOpenArVatBasisContribution({
                amountsIncludeVat: false,
                outstandingWithVat: -117,
                amountWithoutVat: -100,
                amountWithVat: -117,
            })
        ).toBeCloseTo(-100, 10);
    });

    it("returns full outstanding when exclude VAT but without-VAT is missing", () => {
        expect(
            computeOpenArVatBasisContribution({
                amountsIncludeVat: false,
                outstandingWithVat: 117,
                amountWithoutVat: null,
                amountWithVat: 117,
            })
        ).toBe(117);
    });

    it("returns full outstanding when exclude VAT but with-VAT amount is zero", () => {
        expect(
            computeOpenArVatBasisContribution({
                amountsIncludeVat: false,
                outstandingWithVat: 50,
                amountWithoutVat: 40,
                amountWithVat: 0,
            })
        ).toBe(50);
    });
});

describe("applyOpenArVatBasis", () => {
    it("matches include mode gross outstanding", () => {
        expect(
            applyOpenArVatBasis(true, 200, {
                amount_without_vat: 100,
                amount: 117,
            })
        ).toBe(200);
    });

    it("scales exclude mode when VAT triad is present", () => {
        expect(
            applyOpenArVatBasis(false, 117, {
                amount_without_vat: 100,
                amount: 117,
            })
        ).toBeCloseTo(100, 10);
    });
});
