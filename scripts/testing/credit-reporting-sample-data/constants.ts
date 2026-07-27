export const SAMPLE_ACCOUNT_SUBDOMAIN = "credit-reporting-dev";
export const SAMPLE_ACCOUNT_NAME = "Credit Reporting Dev";
export const SAMPLE_ACCOUNT_COMPANY_NUMBER = "CREDIT_REPORTING_DEV";

export const ADMIN_EMAIL = "credit-reporting@dev.local";
export const ADMIN_PASSWORD = "CreditReportingDev123!";

export const PRIMARY_POLICY_NUMBER = "CRD-RPT-PRIMARY";
export const TOPUP_POLICY_NUMBER = "CRD-RPT-TOPUP";
export const TOPUP_MAX_TOTAL_COVER_ILS = 500_000;
/** Headroom above ~20M sample AR so policy residual does not zero compliant exposure. */
export const PRIMARY_MAX_TOTAL_COVER_ILS = 30_000_000;
export const PRIMARY_MAX_TOTAL_DCL_SDL_COVER_ILS = 5_000_000;
export const PRIMARY_MIN_CREDIT_SCORE = 50;
export const PRIMARY_SCORE_VALIDITY_MONTHS = 12;
export const PRIMARY_MAX_DCL_ILS = 500_000;
export const PRIMARY_DCL_CUSTOMER_SINCE_MONTHS = 6;

export const PRIMARY_BUSINESS_UNIT_NAME = "North Region";
export const SECONDARY_BUSINESS_UNIT_NAME = "South Region";

export const DEFAULT_WINDOW_DAYS = 180;
export const DEFAULT_SMOKE_WINDOW_DAYS = 7;
export const DEFAULT_CUSTOMER_COUNT = 100;
export const DEFAULT_INVOICES_TOTAL = 1000;
export const DEFAULT_USD_CUSTOMER_PCT = 20;
export const DEFAULT_AVG_OPEN_INVOICES_PER_CUSTOMER = 10;

export const CUSTOMER_ONBOARDING_DAYS = 30;
export const POLICY_PADDING_DAYS = 30;

export const DASHBOARD_SNAPSHOT_SCOPES_PER_DAY = 9;

export const CHECKPOINT_DIR = "scripts/testing/checkpoints";
export const CHECKPOINT_FILENAME = "credit-reporting-sample-data.json";

export const CUSTOMER_NUMBER_PREFIX = "CRD-RPT";
export const SAMPLE_SCENARIO_TAG_PREFIX = "sample:";

export const PRIMARY_BU_CUSTOMER_PCT = 70;

export const SCENARIO_COMPLIANT_PCT = 65;
export const SCENARIO_GAP_PCT = 15;
export const SCENARIO_BREACH_PCT = 10;
export const SCENARIO_EXCLUDED_ZERO_PCT = 5;
/**
 * Customers on DCL + Pending review (no-policy exposure dashboard cohort).
 * Linked to the primary policy with limit_type DCL, not unassigned.
 */
export const SCENARIO_NO_POLICY_PCT = 5;
/** Credit score for sample DCL customers (policy min is {@link PRIMARY_MIN_CREDIT_SCORE}). */
export const SAMPLE_DCL_CREDIT_SCORE = 72;

export const TOPUP_CUSTOMER_PCT = 20;
export const TOPUP_FIXED_PCT = 70;
export const TOPUP_CAP_BUSTER_COUNT = 3;
export const TOPUP_WAVE_DAYS = [1, 30, 60, 90, 120] as const;
export const TOPUP_WINDOW_FULL_HALF_YEAR_PCT = 60;
export const TOPUP_WINDOW_EXPIRING_30D_PCT = 25;
export const TOPUP_WINDOW_EXPIRING_7D_PCT = 15;
export const TOPUP_FIXED_AMOUNT_MIN_PCT = 25;
export const TOPUP_FIXED_AMOUNT_MAX_PCT = 40;
export const TOPUP_PERCENTAGE_MIN_PCT = 25;
export const TOPUP_PERCENTAGE_MAX_PCT = 50;
export const TOPUP_HALF_YEAR_SPAN_DAYS = 90;
export const TOPUP_EXPIRING_30D_SPAN_DAYS = 25;
export const TOPUP_EXPIRING_7D_SPAN_DAYS = 5;

export const COUNTRY_ID_ISRAEL = 106;
export const COUNTRY_ID_US = 233;

/** USD per 1 ILS is not used — stored rate is ILS base / USD other (see fxRates.ts). */
export const FX_BASE_USD_TO_ILS = 3.65;
export const FX_DRIFT_PCT = 0.005;
export const PARTIAL_PAYMENT_INVOICE_PCT = 35;
export const ACCOUNT_CURRENCY = "ILS";
