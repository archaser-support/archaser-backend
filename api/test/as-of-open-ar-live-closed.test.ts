import {
    computeAsOfOpenInvoiceLine,
    wasAsOfInvoiceOpenAt,
    type AsOfOpenInvoiceLine,
} from "@archaser/credit-insurance-domain";

function day(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

function sampleLine(
    overrides: Partial<AsOfOpenInvoiceLine> = {}
): AsOfOpenInvoiceLine {
    return {
        invoiceId: 1,
        customerId: 10,
        policyId: 2,
        invoiceDate: day("2026-01-05"),
        dueDate: day("2026-04-30"),
        amount: 250,
        customerAmount: 250,
        customerCurrency: "ILS",
        paymentsOnOrBeforeAsOf: 0,
        paymentsCustomerOnOrBeforeAsOf: 0,
        reportingBreach: false,
        ctvPaymentTerm: false,
        ctvCustomerOverdueMep: false,
        ctvOutdatedDcl: false,
        ctvInvoiceAfterPolicyEnd: false,
        inCapacityGap: false,
        ...overrides,
    };
}

describe("as-of open AR uses snapshot day, not today's Paid status", () => {
    const asOf = day("2026-04-01");

    it("keeps currently-Paid invoices open on D when unpaid by D (paid later)", () => {
        const line = sampleLine({
            liveClosed: true,
            lastPaymentDate: day("2026-04-15"),
            paymentsOnOrBeforeAsOf: 0,
            paymentsCustomerOnOrBeforeAsOf: 0,
        });
        expect(wasAsOfInvoiceOpenAt(line, asOf)).toBe(true);
        expect(computeAsOfOpenInvoiceLine(line, asOf)?.openAmount).toBe(250);
    });

    it("does not drop Paid invoices when lastPaymentDate was not loaded for D", () => {
        // Loader used to only expose lastPaymentDate from payments on/before D,
        // so invoices paid after D arrived as liveClosed with null lastPaymentDate.
        const line = sampleLine({
            liveClosed: true,
            lastPaymentDate: null,
            paymentsOnOrBeforeAsOf: 0,
            paymentsCustomerOnOrBeforeAsOf: 0,
        });
        expect(wasAsOfInvoiceOpenAt(line, asOf)).toBe(true);
        expect(computeAsOfOpenInvoiceLine(line, asOf)?.openAmount).toBe(250);
    });

    it("closes Paid invoices on D when the as-of ledger residue is already zero", () => {
        const line = sampleLine({
            liveClosed: true,
            lastPaymentDate: day("2026-03-15"),
            paymentsOnOrBeforeAsOf: 250,
            paymentsCustomerOnOrBeforeAsOf: 250,
        });
        expect(wasAsOfInvoiceOpenAt(line, asOf)).toBe(false);
        expect(computeAsOfOpenInvoiceLine(line, asOf)).toBeNull();
    });

    it("closes when customer-currency leftover is within Paid tolerance (ignore doc dust)", () => {
        // Mirrors SI260003173: doc amount − doc payments ≈ 0.28 (> 0.2), but
        // customer leftover ≈ 0.10 (within Billing Integration ±0.2).
        const line = sampleLine({
            amount: 1_495_897.28,
            customerAmount: 485_051,
            paymentsOnOrBeforeAsOf: 1_495_897,
            paymentsCustomerOnOrBeforeAsOf: 485_050.9,
            openAmountTolerance: 0.2,
            liveClosed: true,
            lastPaymentDate: day("2026-06-15"),
            invoiceDate: day("2026-02-11"),
            dueDate: day("2026-04-30"),
        });
        const asOfIssue = day("2026-06-25");
        expect(wasAsOfInvoiceOpenAt(line, asOfIssue)).toBe(false);
        expect(computeAsOfOpenInvoiceLine(line, asOfIssue)).toBeNull();
    });

    it("keeps snap-loaded Paid residue open before lastPaymentDate (created-in-MEP)", () => {
        // CPT overlay loads siblings as of snapshot day S, then asks whether the
        // trigger was open on an earlier invoice date. Sums already include the
        // later payment; lastPaymentDate must still reopen pre-pay days.
        const line = sampleLine({
            amount: 1_495_897.28,
            customerAmount: 485_051,
            paymentsOnOrBeforeAsOf: 1_495_897,
            paymentsCustomerOnOrBeforeAsOf: 485_050.9,
            openAmountTolerance: 0.2,
            liveClosed: true,
            lastPaymentDate: day("2026-06-15"),
            invoiceDate: day("2026-02-11"),
            dueDate: day("2026-04-30"),
        });
        expect(wasAsOfInvoiceOpenAt(line, day("2026-06-01"))).toBe(true);
        expect(wasAsOfInvoiceOpenAt(line, day("2026-06-15"))).toBe(false);
    });
});
