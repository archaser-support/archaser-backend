/**
 * Eligibility helpers for Issue Claim (full invoices UI is slice 02).
 * Pure checks so API and UI share one contract.
 */

export type ClaimEligibilityFailureReason =
    | "open_not_above_nql"
    | "not_overdue"
    | "reporting_breach_required"
    | "claim_already_exists";

export type ClaimEligibilityInput = {
    openAmount: number;
    /** Primary NQL; null/undefined = no NQL gate. */
    nql: number | null | undefined;
    invoiceStatus: string;
    reportingBreach: boolean;
    existingClaimForInvoice: boolean;
};

export type ClaimEligibilityResult =
    | { eligible: true }
    | { eligible: false; reasons: ClaimEligibilityFailureReason[] };

const OVERDUE_STATUSES = new Set(["Overdue"]);

export function evaluateClaimEligibility(
    input: ClaimEligibilityInput
): ClaimEligibilityResult {
    const reasons: ClaimEligibilityFailureReason[] = [];

    if (input.nql != null && Number.isFinite(Number(input.nql))) {
        if (!(input.openAmount > Number(input.nql))) {
            reasons.push("open_not_above_nql");
        }
    }

    if (!OVERDUE_STATUSES.has(input.invoiceStatus)) {
        reasons.push("not_overdue");
    }

    if (!input.reportingBreach) {
        reasons.push("reporting_breach_required");
    }

    if (input.existingClaimForInvoice) {
        reasons.push("claim_already_exists");
    }

    if (reasons.length > 0) {
        return { eligible: false, reasons };
    }
    return { eligible: true };
}
