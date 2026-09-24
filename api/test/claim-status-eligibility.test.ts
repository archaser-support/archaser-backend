import {
    assertSubmittedRequirements,
    isClaimStatus,
    normalizeClaimStatus,
    requiresLossDate,
    requiresSubmissionFields,
    toDbClaimStatus,
} from "../src/credit-insurance/domain/claims/claimStatus";
import { evaluateClaimEligibility } from "../src/credit-insurance/domain/claims/claimEligibility";

describe("assertSubmittedRequirements", () => {
    it("requires submission date and insurer reference for Submitted+", () => {
        expect(() =>
            assertSubmittedRequirements("Submitted", {
                submissionDate: null,
                insurerSubmissionReference: "REF-1",
            })
        ).toThrow(/submission_date is required/);

        expect(() =>
            assertSubmittedRequirements("Approved", {
                submissionDate: "2025-01-10",
                insurerSubmissionReference: "  ",
            })
        ).toThrow(/insurer_submission_reference/);

        expect(() =>
            assertSubmittedRequirements("Under_Inquiry", {
                submissionDate: "2025-01-10",
                insurerSubmissionReference: "REF-1",
            })
        ).not.toThrow();

        expect(() =>
            assertSubmittedRequirements("Under Inquiry", {
                submissionDate: new Date("2025-01-10T00:00:00.000Z"),
                insurerSubmissionReference: "REF-1",
            })
        ).not.toThrow();
    });

    it("does not require submission fields for Draft or Canceled", () => {
        expect(() =>
            assertSubmittedRequirements("Draft", {
                submissionDate: null,
                insurerSubmissionReference: null,
            })
        ).not.toThrow();
        expect(() =>
            assertSubmittedRequirements("Canceled", {
                submissionDate: null,
                insurerSubmissionReference: null,
            })
        ).not.toThrow();
    });
});

describe("requiresSubmissionFields / requiresLossDate", () => {
    it("marks Submitted through Rejected as requiring submission fields", () => {
        expect(requiresSubmissionFields("Submitted")).toBe(true);
        expect(requiresSubmissionFields("Under_Inquiry")).toBe(true);
        expect(requiresSubmissionFields("Under Inquiry")).toBe(true);
        expect(requiresSubmissionFields("Approved")).toBe(true);
        expect(requiresSubmissionFields("Paid")).toBe(true);
        expect(requiresSubmissionFields("Rejected")).toBe(true);
        expect(requiresSubmissionFields("Draft")).toBe(false);
        expect(requiresSubmissionFields("Canceled")).toBe(false);
    });

    it("requires loss date only for Rejected", () => {
        expect(requiresLossDate("Rejected")).toBe(true);
        expect(requiresLossDate("Draft")).toBe(false);
        expect(requiresLossDate("Submitted")).toBe(false);
    });
});

describe("normalizeClaimStatus / toDbClaimStatus", () => {
    it("maps Under Inquiry aliases", () => {
        expect(normalizeClaimStatus("Under Inquiry")).toBe("Under_Inquiry");
        expect(normalizeClaimStatus("Under_Inquiry")).toBe("Under_Inquiry");
        expect(toDbClaimStatus("Under_Inquiry")).toBe("Under Inquiry");
        expect(isClaimStatus("Under Inquiry")).toBe(true);
    });
});

describe("isClaimStatus", () => {
    it("accepts the claim lifecycle statuses", () => {
        expect(isClaimStatus("Under_Inquiry")).toBe(true);
        expect(isClaimStatus("Open")).toBe(false);
    });
});

describe("evaluateClaimEligibility", () => {
    it("passes when open > NQL, overdue, reporting breach, and no existing claim", () => {
        expect(
            evaluateClaimEligibility({
                openAmount: 10000,
                nql: 8750,
                invoiceStatus: "Overdue",
                reportingBreach: true,
                existingClaimForInvoice: false,
            })
        ).toEqual({ eligible: true });
    });

    it("skips NQL gate when NQL is unset", () => {
        expect(
            evaluateClaimEligibility({
                openAmount: 100,
                nql: null,
                invoiceStatus: "Overdue",
                reportingBreach: true,
                existingClaimForInvoice: false,
            })
        ).toEqual({ eligible: true });
    });

    it("collects failure reasons", () => {
        const result = evaluateClaimEligibility({
            openAmount: 100,
            nql: 8750,
            invoiceStatus: "Open",
            reportingBreach: false,
            existingClaimForInvoice: true,
        });
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reasons).toEqual([
                "open_not_above_nql",
                "not_overdue",
                "reporting_breach_required",
                "claim_already_exists",
            ]);
        }
    });
});
