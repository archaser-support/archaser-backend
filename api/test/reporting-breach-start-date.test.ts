import {
    isInvoiceInReportingBreachScope,
} from "../../packages/credit-insurance-domain/src/credit-insurance/domain/shared/reportingBreachScope";
import { resolveReportingBreachStartDateChange } from "../src/billing-connector/billing-connector-backfill-options";

describe("reporting breach start date", () => {
    describe("isInvoiceInReportingBreachScope", () => {
        it("fails closed when start date is missing", () => {
            expect(
                isInvoiceInReportingBreachScope(
                    new Date(Date.UTC(2025, 5, 1)),
                    null
                )
            ).toBe(false);
        });

        it("includes invoices on or after the start date", () => {
            const start = new Date(Date.UTC(2025, 5, 1));
            expect(
                isInvoiceInReportingBreachScope(
                    new Date(Date.UTC(2025, 5, 1)),
                    start
                )
            ).toBe(true);
            expect(
                isInvoiceInReportingBreachScope(
                    new Date(Date.UTC(2025, 4, 31)),
                    start
                )
            ).toBe(false);
        });
    });

    describe("resolveReportingBreachStartDateChange", () => {
        it("requires a date on create when omitted", () => {
            const result = resolveReportingBreachStartDateChange({
                existingStartDate: null,
                nextInput: undefined,
                requireOnOmit: true,
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.code).toBe("REPORTING_BREACH_START_DATE_REQUIRED");
            }
        });

        it("rejects empty clear attempts", () => {
            const result = resolveReportingBreachStartDateChange({
                existingStartDate: new Date(Date.UTC(2025, 0, 1)),
                nextInput: "",
            });
            expect(result.ok).toBe(false);
        });

        it("marks changed when the calendar day differs", () => {
            const result = resolveReportingBreachStartDateChange({
                existingStartDate: new Date(Date.UTC(2025, 0, 1)),
                nextInput: "2025-06-01",
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.changed).toBe(true);
                expect(result.value).toEqual(new Date(Date.UTC(2025, 5, 1)));
            }
        });

        it("does not mark changed when the same day is resent", () => {
            const result = resolveReportingBreachStartDateChange({
                existingStartDate: new Date(Date.UTC(2025, 5, 1)),
                nextInput: "2025-06-01",
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.changed).toBe(false);
            }
        });
    });
});
