import { describe, expect, it } from "vitest";
import { normalizeInvoiceImportInput } from "../src/import/normalizeInvoiceImportInput";

describe("normalizeInvoiceImportInput", () => {
    it("extracts priority_erp_debit as 'C' without altering negative amounts", () => {
        const result = normalizeInvoiceImportInput(
            {
                customer_number: "CUST101",
                invoice_number: "INV-C1",
                invoice_date: "2024-05-01",
                DEBIT: "C",
                base_amount: -500,
                invoice_amount: -500,
                currency: "USD",
            },
            10
        );

        expect(result.priority_erp_debit).toBe("C");
        expect(result.amount).toBe(-500);
        expect(result.customer_amount).toBe(-500);
    });

    it("extracts priority_erp_debit as 'D' and keeps amounts as-is", () => {
        const result = normalizeInvoiceImportInput(
            {
                customer_number: "CUST102",
                invoice_number: "INV-D1",
                invoice_date: "2024-05-01",
                DEBIT: "D",
                base_amount: 1000,
                invoice_amount: 1000,
            },
            10
        );

        expect(result.priority_erp_debit).toBe("D");
        expect(result.amount).toBe(1000);
        expect(result.customer_amount).toBe(1000);
    });

    it("leaves priority_erp_debit undefined when DEBIT is missing", () => {
        const result = normalizeInvoiceImportInput(
            {
                customer_number: "CUST103",
                invoice_number: "INV-M1",
                invoice_date: "2024-05-01",
                amount: 250,
                customer_amount: 250,
            },
            10
        );

        expect(result.priority_erp_debit).toBeUndefined();
        expect(result.amount).toBe(250);
        expect(result.customer_amount).toBe(250);
    });

    it("reads DEBIT from _rawRecord if wrapped", () => {
        const result = normalizeInvoiceImportInput(
            {
                customer_number: "CUST104",
                invoice_number: "INV-R1",
                invoice_date: "2024-05-01",
                amount: -750,
                customer_amount: -750,
                _rawRecord: {
                    DEBIT: "c",
                },
            },
            10
        );

        expect(result.priority_erp_debit).toBe("C");
        expect(result.amount).toBe(-750);
        expect(result.customer_amount).toBe(-750);
    });
});
