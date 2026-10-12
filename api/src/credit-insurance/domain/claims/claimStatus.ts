export const CLAIM_STATUSES = [
    "Draft",
    "Submitted",
    "Under_Inquiry",
    "Approved",
    "Paid",
    "Rejected",
    "Canceled",
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** DB / Prisma enum uses a space; UI uses underscore. */
const CLAIM_STATUS_ALIASES: Record<string, ClaimStatus> = {
    "Under Inquiry": "Under_Inquiry",
    Under_Inquiry: "Under_Inquiry",
};

export function normalizeClaimStatus(value: unknown): ClaimStatus | null {
    if (typeof value !== "string") {
        return null;
    }
    const aliased = CLAIM_STATUS_ALIASES[value] ?? value;
    return (CLAIM_STATUSES as readonly string[]).includes(aliased)
        ? (aliased as ClaimStatus)
        : null;
}

/** Statuses that require submission date (+ insurer claim reference). */
export const CLAIM_STATUSES_REQUIRING_SUBMISSION = [
    "Submitted",
    "Under_Inquiry",
    "Approved",
    "Paid",
    "Rejected",
] as const;

export function isClaimStatus(value: unknown): value is ClaimStatus {
    return normalizeClaimStatus(value) != null;
}

export function requiresSubmissionFields(status: string): boolean {
    const normalized = normalizeClaimStatus(status) ?? status;
    return (CLAIM_STATUSES_REQUIRING_SUBMISSION as readonly string[]).includes(
        normalized
    );
}

export function requiresLossDate(status: string): boolean {
    return (normalizeClaimStatus(status) ?? status) === "Rejected";
}

/** Map UI status to the DB enum label. */
export function toDbClaimStatus(status: ClaimStatus | string): string {
    const normalized = normalizeClaimStatus(status) ?? status;
    return normalized === "Under_Inquiry" ? "Under Inquiry" : normalized;
}

export type SubmittedRequirements = {
    submissionDate: Date | string | null | undefined;
    insurerSubmissionReference: string | null | undefined;
};

function hasSubmissionDate(
    value: Date | string | null | undefined
): boolean {
    if (value == null) {
        return false;
    }
    if (value instanceof Date) {
        return !Number.isNaN(value.getTime());
    }
    const raw = String(value).trim();
    if (!raw) {
        return false;
    }
    // Accept YYYY-MM-DD or ISO datetime.
    const ymd = raw.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd);
}

/**
 * Submitted and later lifecycle statuses (except Canceled) require
 * submission date + insurer claim reference.
 */
export function assertSubmittedRequirements(
    status: string,
    requirements: SubmittedRequirements
): void {
    if (!requiresSubmissionFields(status)) {
        return;
    }
    const dateOk = hasSubmissionDate(requirements.submissionDate);
    const refOk =
        requirements.insurerSubmissionReference != null &&
        String(requirements.insurerSubmissionReference).trim() !== "";
    if (!dateOk && !refOk) {
        throw new Error(
            "submission_date and insurer_submission_reference are required for this status"
        );
    }
    if (!dateOk) {
        throw new Error("submission_date is required for this status");
    }
    if (!refOk) {
        throw new Error(
            "insurer_submission_reference is required for this status"
        );
    }
}
