import {
    computeInsuranceTargetDates,
    computeInvoiceInsuranceRowData,
    parseImportDateToLocalCalendarDate,
    shouldSetReportingBreach,
} from "@archaser/credit-insurance-domain";

const baseCustomer = {
    reporting_days: 5,
    max_allowed_mep: 7,
    max_payment_term: 30,
};

describe("negative invoice amount — insurance targets and reporting breach", () => {
    it("returns null target MEP and reporting dates when amount is negative", () => {
        const targets = computeInsuranceTargetDates({
            amount: -100,
            due_date: new Date("2025-01-10"),
            invoice_date: new Date("2025-01-01"),
            customer: baseCustomer,
        });
        expect(targets.target_mep_date).toBeNull();
        expect(targets.target_reporting_date).toBeNull();
    });

    it("still computes targets for zero and positive amounts", () => {
        const zero = computeInsuranceTargetDates({
            amount: 0,
            due_date: new Date("2025-01-10"),
            invoice_date: new Date("2025-01-01"),
            customer: baseCustomer,
        });
        expect(zero.target_reporting_date?.toISOString().slice(0, 10)).toBe(
            "2025-01-15"
        );
        expect(zero.target_mep_date?.toISOString().slice(0, 10)).toBe(
            "2025-01-17"
        );

        const positive = computeInsuranceTargetDates({
            amount: 250,
            due_date: new Date("2025-01-10"),
            invoice_date: new Date("2025-01-01"),
            customer: baseCustomer,
        });
        expect(positive.target_reporting_date?.toISOString().slice(0, 10)).toBe(
            "2025-01-15"
        );
        expect(positive.target_mep_date?.toISOString().slice(0, 10)).toBe(
            "2025-01-17"
        );
    });

    it("keeps month-end cutoff math for positive amounts", () => {
        const invoiceDate = parseImportDateToLocalCalendarDate("2026-06-24")!;
        const dueDate = parseImportDateToLocalCalendarDate("2026-06-26")!;
        const targets = computeInsuranceTargetDates({
            amount: 1000,
            due_date: dueDate,
            invoice_date: invoiceDate,
            customer: {
                reporting_days: 40,
                max_allowed_mep: 30,
                max_payment_term: 60,
                mep_cutoff_day_of_month: 24,
                mep_substitute_day_of_month: 2,
                reporting_cutoff_day_of_month: null,
                reporting_substitute_day_of_month: null,
            },
        });
        // substitute 2 Jul; diff = 8; due 26 Jun + 30 + 8 → 3 Aug; reporting = due + 40
        expect(targets.target_mep_date!.getFullYear()).toBe(2026);
        expect(targets.target_mep_date!.getMonth()).toBe(7);
        expect(targets.target_mep_date!.getDate()).toBe(3);
        expect(targets.target_reporting_date!.getFullYear()).toBe(2026);
        expect(targets.target_reporting_date!.getMonth()).toBe(7);
        expect(targets.target_reporting_date!.getDate()).toBe(5);
    });

    it("nulls targets and never sets reporting_breach on the shared insurance row for negatives", () => {
        const row = computeInvoiceInsuranceRowData({
            amount: -50,
            status: "Overdue",
            invoice_date: new Date("2025-01-01"),
            due_date: new Date("2025-01-10"),
            customer: baseCustomer,
            today: new Date("2025-06-01"),
        });
        expect(row.target_mep_date).toBeNull();
        expect(row.target_reporting_date).toBeNull();
        expect(row.reporting_breach).toBe(false);
        // Payment term / CTV payment-term stay amount-agnostic
        expect(row.payment_term).toBe(9);
        expect(row.ctv_payment_term).toBe(false);
    });

    it("still sets reporting_breach for positive overdue invoices past target reporting", () => {
        const row = computeInvoiceInsuranceRowData({
            amount: 100,
            status: "Overdue",
            invoice_date: new Date("2026-01-01"),
            due_date: new Date("2026-01-20"),
            customer: {
                reporting_days: 35,
                max_allowed_mep: 7,
                max_payment_term: 30,
            },
            today: parseImportDateToLocalCalendarDate("2026-05-12")!,
        });
        expect(row.reporting_breach).toBe(true);
    });

    it("never evaluates reporting breach as true when amount is negative even with a stale target date", () => {
        expect(
            shouldSetReportingBreach(
                "Overdue",
                new Date("2020-01-01"),
                null,
                new Date("2025-06-01"),
                -10
            )
        ).toBe(false);
    });

    it("still evaluates reporting breach for zero-amount invoices", () => {
        expect(
            shouldSetReportingBreach(
                "Overdue",
                new Date("2020-01-01"),
                null,
                new Date("2025-06-01"),
                0
            )
        ).toBe(true);
    });
});
