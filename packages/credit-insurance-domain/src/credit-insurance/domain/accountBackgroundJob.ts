/** Shared progress row kinds for admin-driven account background work. */
export const ACCOUNT_BACKGROUND_JOB_KIND = {
    CREDIT_ASOF_BACKFILL: "credit_asof_backfill",
    VAT_BASIS_REFRESH: "vat_basis_refresh",
} as const;

export type AccountBackgroundJobKind =
    (typeof ACCOUNT_BACKGROUND_JOB_KIND)[keyof typeof ACCOUNT_BACKGROUND_JOB_KIND];
