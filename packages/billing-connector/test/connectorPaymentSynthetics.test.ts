import { describe, expect, it } from "vitest";

import {
    applyPaymentSynthetics,
    collectPaymentReferenceAliases,
} from "../src/payment/connectorPaymentSynthetics";
import {
    mergeEntitySetsPatch,
    normalizeEntitySetName,
    parseEntitySetsMap,
    resolveEntityCollectionPath,
} from "../src/services/billingConnectorEntitySets";

describe("applyPaymentSynthetics", () => {
    it("prefers non-zero CREDIT1 over DEBIT1", () => {
        const row = applyPaymentSynthetics({
            CREDIT1: 100,
            DEBIT1: 50,
            FNCNUM: "24001",
            KLINE: 2,
            FNCDATE: "2024-01-02T00:00:00Z",
        });
        expect(row.PAY_AMOUNT).toBe(100);
        expect(row.PAY_REFERENCE).toBe("24001|2");
        expect(row.PAY_DATE).toBe("2024-01-02T00:00:00Z");
    });

    it("falls back to DEBIT1 and BALDATE", () => {
        const row = applyPaymentSynthetics({
            CREDIT1: 0,
            DEBIT1: 75,
            FNCNUM: "24002",
            KLINE: 1,
            BALDATE: "2024-03-01T00:00:00Z",
        });
        expect(row.PAY_AMOUNT).toBe(75);
        expect(row.PAY_DATE).toBe("2024-03-01T00:00:00Z");
    });

    it("falls back to IVNUM when FNCNUM and PAYNUM are missing", () => {
        const row = applyPaymentSynthetics({
            DEBIT1: 144000,
            IVNUM: "RC169RL000721",
            FNCDATE: "2016-10-26T00:00:00Z",
        });
        expect(row.PAY_AMOUNT).toBe(144000);
        expect(row.PAY_REFERENCE).toBe("RC169RL000721");
        expect(row.PAY_INVOICE_NUMBER).toBe("RC169RL000721");
    });

    it("groups split settlements with FRECONNUM|FNCNUM|KLINE", () => {
        const row = applyPaymentSynthetics({
            FRECONNUM: 764,
            FNCNUM: "25169038",
            KLINE: 1,
            IVNUM: "CR250000965",
            FNCIREF1: "CR250000965",
            CREDIT1: 7291.7,
            FNCDATE: "2026-01-31T00:00:00+02:00",
        });
        expect(row.PAY_REFERENCE).toBe("764|25169038|1");
        expect(row.PAY_INVOICE_NUMBER).toBe("CR250000965");
        expect(row.PAY_AMOUNT).toBe(7291.7);
    });

    it("keeps cancel rows unique by FNCNUM and preserves signed amount", () => {
        const row = applyPaymentSynthetics({
            FRECONNUM: 771,
            FNCNUM: "25198017",
            KLINE: 1,
            IVNUM: "CR250001074",
            FNCIREF1: "CR250001073",
            CREDIT1: -431.68,
            FNCDATE: "2026-03-31T00:00:00+03:00",
        });
        expect(row.PAY_REFERENCE).toBe("771|25198017|1");
        expect(row.PAY_INVOICE_NUMBER).toBe("CR250001073");
        expect(row.PAY_AMOUNT).toBe(-431.68);
    });

    it("falls back to FNCNUM|KLINE when FRECONNUM is missing", () => {
        const row = applyPaymentSynthetics({
            FNCNUM: "25174539",
            KLINE: 1,
            IVNUM: "CR250000978",
            CREDIT1: 611.88,
        });
        expect(row.PAY_REFERENCE).toBe("25174539|1");
    });

    it("prefers FNCNUM over IVNUM when FRECONNUM is absent", () => {
        const row = applyPaymentSynthetics({
            FNCNUM: "24001",
            IVNUM: "CR250000978",
            KLINE: 2,
            CREDIT1: 100,
        });
        expect(row.PAY_REFERENCE).toBe("24001|2");
    });

    it("copies FNCPATNAME onto PAYDES so payment_method stores the code", () => {
        const row = applyPaymentSynthetics({
            FNCPATNAME: "חלמ",
            PAYDES: "Bank transfer",
            FNCNUM: "26087582",
            CREDIT1: 3000,
        });
        expect(row.PAYDES).toBe("חלמ");
    });

    it("keeps PAYDES when FNCPATNAME is blank", () => {
        const row = applyPaymentSynthetics({
            FNCPATNAME: "  ",
            PAYDES: "Bank transfer",
            FNCNUM: "26087582",
            CREDIT1: 2000,
        });
        expect(row.PAYDES).toBe("Bank transfer");
    });

    it("copies FNCPATNAME as-is and does not shorten a longer label to ק", () => {
        const row = applyPaymentSynthetics({
            FNCPATNAME: "Receit - payment ק",
            PAYDES: "Wire",
            FNCNUM: "1",
            CREDIT1: 2000,
        });
        expect(row.PAYDES).toBe("Receit - payment ק");
    });

    it("lists old IVNUM|KLINE aliases alongside the new recon reference", () => {
        const aliases = collectPaymentReferenceAliases(
            {
                FRECONNUM: 764,
                FNCNUM: "25169038",
                KLINE: 1,
                IVNUM: "CR250000965",
            },
            "764|25169038|1",
            "CR250000965"
        );
        expect(aliases).toEqual(
            expect.arrayContaining([
                "764|25169038|1",
                "25169038|1",
                "CR250000965|1",
                "CR250000965",
                "25169038",
            ])
        );
    });
});

describe("billingConnectorEntitySets", () => {
    it("parses and merges entity set overrides", () => {
        const existing = parseEntitySetsMap({
            Payment: "TOTARPAY",
            Invoice: "CINVOICES",
        });
        const merged = mergeEntitySetsPatch(existing, {
            Payment: "IDG_ARFNCITEMS4",
            Invoice: null,
        });
        expect(merged).toEqual({ Payment: "IDG_ARFNCITEMS4" });
    });

    it("rejects invalid entity set names", () => {
        expect(() => normalizeEntitySetName("bad name")).toThrow(
            /Invalid Priority table name/
        );
    });

    it("resolves collection path with override", () => {
        expect(
            resolveEntityCollectionPath("Payment", {
                Payment: "IDG_ARFNCITEMS4",
            })
        ).toBe("IDG_ARFNCITEMS4");
        expect(resolveEntityCollectionPath("Payment", {})).toBe("TOTARPAY");
    });
});
