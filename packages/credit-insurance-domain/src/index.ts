/**
 * Public surface of the shared credit-insurance domain.
 *
 * Grouped by consumer so it is obvious what each process needs:
 *   - database binding, required by every consumer before any query
 *   - the reports service's report-generation surface
 *   - the entry points the worker (cron-jobs) and connectors (billing-connector)
 *     load today by filename out of `api/dist`
 */

// --- Database binding (all consumers) ---
export {
    bindCreditInsurancePrisma,
    CreditInsurancePrismaNotBoundError,
    prisma as creditInsurancePrisma,
    type DbClient,
} from "./credit-insurance/domain-db";

// --- Reports service surface ---
export {
    enrichCreditDashboardCustomerRows,
    fetchTopUpExpiringReportAsCustomerRows,
    isCreditDashboardEnrichedSortField,
    reportConfigNeedsCreditDashboardEnrichment,
    sortCreditDashboardEnrichedRows,
} from "./credit-insurance/domain/creditDashboardReportEnrichment";
export { getLimitWarningReport } from "./credit-insurance/domain/creditInsuranceDashboardService";
export {
    reportedInvoicesMembershipWhere,
    reportingCountdownMembershipWhere,
    resolveReportingCountdownWindowDays,
    termsBreachMembershipWhere,
} from "./credit-insurance/domain/creditDashboardInvoiceMembership";
export { customersScopedForCreditDashboard } from "./credit-insurance/domain/customerPolicyQueryHelpers";
export {
    resolveCreditCustomerMembershipIds,
    zeroLimitWarningMembershipWhere,
} from "./credit-insurance/domain/creditDashboardCustomerMembership";
export {
    UTILIZATION_DISTRIBUTION_BIN_KEYS,
    assignUtilizationDistributionBin,
    isUtilizationDistributionBinKey,
    utilizationDistributionRiskZone,
    type UtilizationDistributionBinKey,
    type UtilizationDistributionRiskZone,
} from "./credit-insurance/domain/utilizationDistributionBins";
export {
    fetchUtilizationBinCptCustomers,
    fetchAsOfUtilizationByCustomerIds,
} from "./credit-insurance/domain/utilizationBinReport";
export {
    CUSTOMER_POLICY_BACKED_REPORT_FIELDS,
    extractCustomerPolicyReportField,
    getCustomerPolicyRow,
    isCustomerPolicyBackedReportField,
    mergeActiveCustomerPolicySelect,
} from "./reports/report-customer-policy-fields.util";

// --- Worker / connector entry points (currently loaded dynamically; slice 04 switches them to these) ---
export { syncCustomerInsuranceFields } from "./credit-insurance/domain/syncCustomerInsuranceFields";
export {
    refreshInsuranceTargetDatesForInvoiceIds,
    sweepReportingBreachForOverdueInvoiceIds,
} from "./credit-insurance/domain/syncInvoiceReportingBreach";
export { runInsurancePolicyStatusMaintenance } from "./credit-insurance/domain/insurancePolicyStatusCron";
export { fetchUncoveredCustomerIdsForAccount } from "./credit-insurance/domain/termBreachResolver";
export { syncAllCustomerPolicyGapAmounts } from "./credit-insurance/domain/syncCustomerPolicyGapAmounts";
export { takeCreditDashboardDailySnapshots } from "./credit-insurance/domain/creditDashboardSnapshotService";
export { takeInsurancePolicyTrendSnapshots } from "./credit-insurance/domain/insurancePolicyTrendService";
export { takeCustomerPolicyTrendSnapshots } from "./credit-insurance/domain/customerPolicyTrendService";
export {
    drainAsOfRewriteQueue,
    enqueueRewriteForImport,
} from "./credit-insurance/domain/asOfRewriteQueue";

// --- Chronological AR replay surface (cron-jobs' arPostIngest orchestrator) ---
export {
    computeCreatedTermsViolationSnapshot,
    computeInsuranceTargetDates,
    computeInvoiceCapacityGapContribution,
    computeInvoiceInsuranceRowData,
    computeLimitAssessedAmountForNewOpenInvoice,
    invoiceOutstandingInLimitCurrency,
    parseImportDateToLocalCalendarDate,
    shouldSetReportingBreach,
} from "./credit-insurance/domain/invoiceInsuranceFields";
export {
    stampInvoiceInsuranceFieldsAsOf,
    stampInvoicesInsuranceFieldsAsOf,
    type InvoiceInsuranceAsOfStamp,
} from "./credit-insurance/domain/stampInvoiceInsuranceFieldsAsOf";
export {
    resolveCreatedOverdueMepByInvoiceId,
    resolveCreatedOverdueMepForInvoice,
} from "./credit-insurance/domain/createdOverdueMepAtInvoiceDate";

// --- MEP breach start date gate (shared by cause side, flag side and replay) ---
export {
    filterInvoicesInMepBreachScope,
    isInvoiceInMepBreachScope,
} from "./credit-insurance/domain/shared/mepBreachScope";
export {
    clearMepBreachStartDateCache,
    resolveMepBreachStartDate,
} from "./credit-insurance/domain/resolveMepBreachStartDate";
export {
    clearInvoicePaidToleranceCache,
    resolveInvoicePaidTolerance,
} from "./credit-insurance/domain/resolveInvoicePaidTolerance";

// --- Reporting breach start date gate (imported pre-go-live history) ---
export { isInvoiceInReportingBreachScope } from "./credit-insurance/domain/shared/reportingBreachScope";
export {
    clearReportingBreachStartDateCache,
    resolveReportingBreachStartDate,
    resolveReportingBreachStartDatesForAccounts,
} from "./credit-insurance/domain/resolveReportingBreachStartDate";

// --- Api service surface ---
// The api service's dashboards, controllers and its own api-only domain files
// (as-of backfill, portfolio health, registration fee, top-up parent policy)
// reach the shared domain through these.
export {
    enqueueAsOfRewrite,
    isAdminBackfillBlockingDrain,
    resolveRewriteDrainStart,
} from "./credit-insurance/domain/asOfRewriteQueue";
export {
    __resetCreditAsOfBackfillRunnersForTests,
    countInclusiveUtcDays,
    CreditAsOfBackfillConflictError,
    enumerateUtcDaysInclusive,
    getCreditAsOfBackfillJobStatus,
    listRunningCreditAsOfBackfillAccountIds,
    pauseCreditAsOfBackfillJob,
    registerCreditAsOfBackfillDispatch,
    creditAsOfBackfillBullJobId,
    retryCreditAsOfBackfillJob,
    runCreditAsOfBackfillJob,
    startCreditAsOfBackfillJob,
    type CreditAsOfBackfillJobView,
    type CreditAsOfBackfillStatus,
} from "./credit-insurance/domain/creditAsOfBackfillJob";
export {
    asOfCustomerOverdueBlockAt,
    asOfTermsScopeKey,
    loadAsOfOpenInvoiceCandidates,
    overlayAsOfTermsFlagsOnLines,
    type AsOfOpenInvoiceLine,
    type AsOfPolicyTermsForBreach,
} from "./credit-insurance/domain/asOfOpenAr";
export {
    aggregateLedgerPaymentsOnOrBefore,
    deriveAsOfOpenInvoiceCandidatesFromLedger,
    loadAsOfOpenInvoiceLedgerRange,
    type AsOfLedgerInvoiceRow,
    type AsOfLedgerPaymentRow,
    type AsOfOpenInvoiceLedger,
} from "./credit-insurance/domain/asOfOpenArLedgerPreload";
export {
    buildCreditAsOfBackfillRunContext,
    createMinimalCreditAsOfBackfillRunContext,
    deriveDashboardSnapshotScopes,
    ensureCapacityGapsForBackfillRun,
    loadActiveCustomerPoliciesForTrendSync,
    type CreditAsOfBackfillRunContext,
    type CreditDashboardSnapshotScope,
} from "./credit-insurance/domain/creditAsOfBackfillRunContext";
export {
    batchUpsertCustomerPolicyTrendRows,
    CUSTOMER_POLICY_TREND_BATCH_UPSERT_CHUNK_SIZE,
    type CustomerPolicyTrendUpsertRow,
} from "./credit-insurance/domain/customerPolicyTrendBatchUpsert";
export {
    computeCreditDashboardHealthIndex,
    getCreditDashboardSummaryHistory,
    takeCreditDashboardDailySnapshotsForAccount,
} from "./credit-insurance/domain/creditDashboardSnapshotService";
export {
    getCapacityGapReport,
    getCreditDashboardSummary,
    getNoPolicyExposureReport,
    getOverdueBlockReport,
    getPolicyRiskExposureReport,
    getReportedInvoicesReport,
    getReportingCountdownOpenReport,
    getTermsBreachReport,
    getZeroLimitWarningReport,
    isTermsBreachReasonFilter,
    type CreditReportListOptions,
} from "./credit-insurance/domain/creditInsuranceDashboardService";
export {
    getTopUpCoverReport,
    getTopUpExpiringReport,
} from "./credit-insurance/domain/creditInsuranceTopUpDashboardService";
export { getCustomerDashboardKpis } from "./credit-insurance/domain/customerDashboardKpisService";
export {
    computeCustomerOutdatedDcl,
    isDclCustomerCreditScoreBelowPolicyMin,
    resolveDclApprovedLimitAfterOutdatedRecompute,
} from "./credit-insurance/domain/customerOutdatedDcl";
export { computeTopUpDailyCostAggregate } from "./credit-insurance/domain/customerPolicyDailyCost";
export {
    getCustomerPolicyTrendForCustomer,
    getCustomerPolicyUsageTrend,
    syncCustomerPolicyTrendSnapshotForAccount,
} from "./credit-insurance/domain/customerPolicyTrendService";
export type { TermsBreachByReasonSnapshotKey } from "./credit-insurance/domain/customerPolicyTrendTermsBreachByReason";
export type { CustomerPolicyWriteInput } from "./credit-insurance/domain/customerPolicyTypes";
export { hasTopUpPolicies } from "./credit-insurance/domain/hasTopUpPolicies";
export { deactivateExpiredInsurancePolicies } from "./credit-insurance/domain/insurancePolicyStatusCron";
export {
    getInsurancePolicyConfigChanges,
    getInsurancePolicyCountryTrend,
    getInsurancePolicyTrend,
    getNamedPolicyTrend,
} from "./credit-insurance/domain/insurancePolicyTrendService";
export { loadEffectiveInsuranceForCustomers } from "./credit-insurance/domain/loadEffectiveInsuranceForCustomers";
export { resolveCustomerHeaderOpenArAmounts } from "./credit-insurance/domain/openReceivableByCustomerCurrency";
export {
    isActiveTopUp,
    resolveEffectiveApprovedLimit,
    resolveEffectiveApprovedLimitFromTopUpRows,
    resolveTopUpTotalsForAsOfDates,
} from "./credit-insurance/domain/resolveEffectiveApprovedLimit";
export {
    isPrimaryPolicyAssignable,
    startOfTodayUtc,
} from "./credit-insurance/domain/shared/insurancePolicyLifecycle";
export {
    deriveExcludedFromPolicy,
    isAllowedPolicyExclusionReason,
    isPendingReviewExclusion,
    normalizePolicyExclusionReason,
} from "./credit-insurance/domain/shared/policyExclusion";
export {
    computeGapInBaseCurrency,
    freezeCustomerPolicyGapOnDeactivation,
    recomputeGapInBaseCurrencyForCustomer,
    syncCustomerPolicyGapAmountsForCustomer,
} from "./credit-insurance/domain/syncCustomerPolicyGapAmounts";
