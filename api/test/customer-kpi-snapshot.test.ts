import {
    computeCustomerKpiSnapshotFromInvoices,
    computePolicyCapacityGapKpi,
    resolveCustomerCapacityGapForKpi,
} from "../src/credit-insurance/domain/customerKpiSnapshot";

describe("resolveCustomerCapacityGapForKpi", () => {
    it("keeps full sticky invoice-gap sum when AR exceeds approved limit", () => {
        // Feb 19 Celebration: prior sticky gaps 1750 + new over-limit slice 400
        // must stay 2150 (not capped at excess-over-limit 400).
        expect(
            resolveCustomerCapacityGapForKpi({
                totalAr: 14_400,
                sumInvoiceGaps: 2_150,
                approvedLimit: 14_000,
                retainedCapacityGap: 1_750,
            })
        ).toEqual({ capacity: 2_150, retainedCapacityGap: 2_150 });
    });

    it("uses sticky gap sum even when AR is below approved limit", () => {
        expect(
            resolveCustomerCapacityGapForKpi({
                totalAr: 6_400,
                sumInvoiceGaps: 1_750,
                approvedLimit: 14_000,
                retainedCapacityGap: 0,
            })
        ).toEqual({ capacity: 1_750, retainedCapacityGap: 1_750 });
    });

    it("clears capacity when open invoices no longer carry gaps", () => {
        expect(
            resolveCustomerCapacityGapForKpi({
                totalAr: 7_200,
                sumInvoiceGaps: 0,
                approvedLimit: 10_000,
                retainedCapacityGap: 1_900,
            })
        ).toEqual({ capacity: 0, retainedCapacityGap: 0 });
    });
});

describe("computePolicyCapacityGapKpi", () => {
    it("matches resolveCustomerCapacityGapForKpi for over-limit day", () => {
        expect(
            computePolicyCapacityGapKpi({
                totalAr: 14_400,
                sumInvoiceGaps: 2_150,
                approvedLimit: 14_000,
                retainedCapacityGap: 1_750,
            })
        ).toEqual({ capacityGapAmount: 2_150, retainedCapacityGap: 2_150 });
    });
});

describe("computeCustomerKpiSnapshotFromInvoices", () => {
    it("keeps sticky capacity after a new invoice pushes AR over the limit", () => {
        const snapshot = computeCustomerKpiSnapshotFromInvoices({
            approvedLimit: 14_000,
            asOf: new Date("2026-02-19T00:00:00.000Z"),
            openInvoices: [
                {
                    outstanding: 6_400,
                    limitAssessedAmount: 6_400,
                    capacityGapAmount: 1_750,
                    capacityGapAmountLimit: 1_750,
                    inCapacityGap: true,
                    targetReportingDate: null,
                    ctvPaymentTerm: false,
                    ctvCustomerOverdueMep: false,
                },
                {
                    outstanding: 8_000,
                    limitAssessedAmount: 7_600,
                    capacityGapAmount: 400,
                    capacityGapAmountLimit: 400,
                    inCapacityGap: true,
                    targetReportingDate: null,
                    ctvPaymentTerm: false,
                    ctvCustomerOverdueMep: false,
                },
            ],
            retainedCapacityGap: 1_750,
        });

        expect(snapshot.totalAr).toBe(14_400);
        expect(snapshot.capacity).toBe(2_150);
        expect(snapshot.notInsured).toBe(2_150);
        expect(Math.round(snapshot.healthIndex * 100)).toBe(85);
    });

    it("computes Jan 27 golden row from remaining sticky gaps on open invoices", () => {
        const snapshot = computeCustomerKpiSnapshotFromInvoices({
            approvedLimit: 10_000,
            asOf: new Date(2026, 0, 27),
            openInvoices: [
                {
                    outstanding: 7000,
                    limitAssessedAmount: 7000,
                    capacityGapAmount: 0,
                    capacityGapAmountLimit: 0,
                    inCapacityGap: false,
                    targetReportingDate: null,
                    ctvPaymentTerm: false,
                    ctvCustomerOverdueMep: false,
                },
            ],
            retainedCapacityGap: 0,
        });

        expect(snapshot.totalAr).toBe(7000);
        expect(snapshot.termBreach).toBe(0);
        expect(snapshot.capacity).toBe(0);
        expect(snapshot.notInsured).toBe(0);
        expect(Math.round(snapshot.healthIndex * 100)).toBe(100);
    });

    it("uncovered exposure → term breach and notInsured equal full open AR", () => {
        const snapshot = computeCustomerKpiSnapshotFromInvoices({
            approvedLimit: 10_000,
            asOf: new Date(2026, 0, 27),
            uncoveredExposure: true,
            openInvoices: [
                {
                    outstanding: 4_000,
                    limitAssessedAmount: 4_000,
                    capacityGapAmount: 0,
                    capacityGapAmountLimit: 0,
                    inCapacityGap: false,
                    targetReportingDate: null,
                    ctvPaymentTerm: true,
                    ctvCustomerOverdueMep: false,
                },
            ],
            retainedCapacityGap: 0,
        });

        expect(snapshot.termBreach).toBe(4_000);
        expect(snapshot.notInsured).toBe(4_000);
    });
});
