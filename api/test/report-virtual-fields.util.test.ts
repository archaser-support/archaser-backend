import {
    applyComputedFieldSelect,
    extractComputedFieldValue,
    extractTermsBreachReasonCodes,
    formatTermsBreachReasonForDisplay,
    isComputedReportField,
    isPrismaScalarField,
} from "../src/reports/report-virtual-fields.util";
import { splitFiltersByTable } from "../src/reports/report-filter.util";

describe("report virtual fields", () => {
    it("does not treat terms_breach_reason as an Invoice Prisma scalar", () => {
        expect(isPrismaScalarField("Invoice", "invoice_number")).toBe(true);
        expect(isPrismaScalarField("Invoice", "terms_breach_reason")).toBe(
            false
        );
        expect(isPrismaScalarField("Invoice", "days_left_for_reporting")).toBe(
            false
        );
        expect(isPrismaScalarField("Customer", "approved_limit")).toBe(false);
        expect(isPrismaScalarField("Dispute", "dispute_number")).toBe(false);
    });

    it("recognizes Country.name and State.name as Prisma scalars for report select", () => {
        expect(isPrismaScalarField("Country", "name")).toBe(true);
        expect(isPrismaScalarField("State", "name")).toBe(true);
        expect(isPrismaScalarField("Country", "iso3")).toBe(true);
    });

    it("expands terms_breach_reason into CTV / reporting flag selects", () => {
        const select: Record<string, unknown> = { id: true };
        expect(
            applyComputedFieldSelect("Invoice", "terms_breach_reason", select)
        ).toBe(true);
        expect(select).toMatchObject({
            reporting_breach: true,
            ctv_payment_term: true,
            ctv_customer_overdue_mep: true,
            ctv_outdated_dcl: true,
            ctv_invoice_after_policy_end: true,
        });
        expect(select.terms_breach_reason).toBeUndefined();
    });

    it("extracts and formats terms breach reason codes", () => {
        const codes = extractTermsBreachReasonCodes({
            reporting_breach: true,
            ctv_payment_term: true,
            ctv_customer_overdue_mep: false,
            ctv_outdated_dcl: false,
            ctv_invoice_after_policy_end: false,
        });
        expect(codes).toBe("reporting_breach · ctv_payment_term");
        expect(formatTermsBreachReasonForDisplay(codes, "en-US")).toBe(
            "Reporting breach · Payment term violation"
        );
        expect(
            extractComputedFieldValue("Invoice", "terms_breach_reason", {
                reporting_breach: true,
                ctv_payment_term: false,
            })
        ).toBe("reporting_breach");
    });

    it("skips virtual Invoice fields in Prisma filter where", () => {
        const { primary } = splitFiltersByTable(
            [
                {
                    table: "Invoice",
                    field: "terms_breach_reason",
                    operator: "contains",
                    value: "reporting",
                },
                {
                    table: "Invoice",
                    field: "invoice_number",
                    operator: "equals",
                    value: "INV-1",
                },
            ],
            "Invoice"
        );
        expect(primary.terms_breach_reason).toBeUndefined();
        expect(primary.invoice_number).toEqual({ equals: "INV-1" });
    });

    it("marks known computed fields", () => {
        expect(isComputedReportField("Invoice", "terms_breach_reason")).toBe(
            true
        );
        expect(isComputedReportField("Invoice", "invoice_number")).toBe(false);
    });
});
