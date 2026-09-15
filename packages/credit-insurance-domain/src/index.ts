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
    refreshCtvSnapshotsForInvoiceIds,
    refreshInsuranceTargetDatesForInvoiceIds,
    refreshTermsBreachFlagsForCustomer,
    refreshTermsBreachFlagsForCustomers,
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
    allocateLiveCapacityGapWaterfall,
    compareInvoicesForLiveCapacityGapWaterfall,
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
export {
    INVOICE_PAID_TOLERANCE,
    INVOICE_PAID_TOLERANCE_MAX,
    INVOICE_PAID_TOLERANCE_MIN,
    isWithinPaidTolerance,
} from "./credit-insurance/domain/invoicePaidTolerance";

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
    buildAsOfAtRiskInvoiceInputsByCustomerInAccountCurrencyFromLines,
    buildAsOfAtRiskInvoiceInputsFromLines,
    buildAsOfPolicyTermsByCustomerMap,
    computeAsOfOpenInvoiceLine,
    isCreatedInCustomerOverdueMep,
    loadAsOfOpenInvoiceCandidates,
    oldestOverdueDueAtEachInvoiceIssueDate,
    overlayAsOfLiveCapacityGapWaterfallOnLines,
    overlayAsOfTermsFlagsForAccountLines,
    overlayAsOfTermsFlagsOnLines,
    wasAsOfInvoiceOpenAt,
    isUtcCalendarToday,
    type AsOfCapacityGapWaterfallScope,
    type AsOfOpenInvoiceLine,
    type AsOfPolicyTermsForBreach,
    type CustomerOverdueMepMonthEnd,
    type OldestOverdueAtIssue,
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
    buildAsOfTermsMapFromActiveCustomerPolicies,
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
    addUtcDaysToYmd,
    analyzeBooleanDaySeries,
    areCalendarConsecutive,
    detectStaleArRuns,
    enumerateBooleanDayRuns,
    longestBooleanStreakWindow,
    longestExactValueStreak,
    longestExactValueStreakWindow,
    trailingLinearSlope,
    utcDayPlusOne,
    ymdToUtcDayNumber,
    type BooleanDayRunEpisode,
    type BooleanDaySeriesAnalysis,
    type CtpArDayPoint,
    type CtpBooleanDayPoint,
    type CtpSnapshotDay,
    type CtpValueDayPoint,
    type ExactValueStreakWindow,
    type StaleArDetectionResult,
    type StaleArRun,
    type StreakWindow,
    type TrailingLinearSlopeOptions,
    type TrailingLinearSlopeResult,
} from "./credit-insurance/domain/shared/ctpDailySeries";
export {
    computeCustomerOverLimitGapMetrics,
    isCapacityGapOverLimitDay,
    summarizePortfolioOverLimitGap,
    type CtpCapacityGapDayPoint,
    type CustomerOverLimitGapMetrics,
    type CustomerOverLimitGapRow,
    type PortfolioOverLimitGapSummary,
} from "./credit-insurance/domain/shared/ctpOverLimitGapMetrics";
export {
    fetchCapacityGapDaysPeriodCustomers,
    fetchCapacityGapDaysPeriodSummary,
    fetchCustomerTrailingOverLimitGapMetrics,
    type FetchCapacityGapDaysPeriodOptions,
} from "./credit-insurance/domain/capacityGapDaysPeriod";
export {
    AR_EXTREME_DOD_PCT_THRESHOLD,
    HEALTH_SLOPE_DETERIORATING_THRESHOLD,
    HEALTH_SLOPE_IMPROVING_THRESHOLD,
    HEALTH_SLOPE_MIN_DAYS,
    classifyHealthSlope,
    computeArVolatility,
    computeCustomerHealthSlopeVolatilityMetrics,
    computeHealthMomentum,
    resolveHealthPeakAndCurrent,
    type ArDodChangePoint,
    type ArNewActivityEvent,
    type ArVolatilityOptions,
    type ArVolatilityResult,
    type CustomerHealthSlopeVolatilityMetrics,
    type HealthMomentumClassification,
    type HealthMomentumOptions,
    type HealthMomentumResult,
} from "./credit-insurance/domain/shared/ctpHealthSlopeVolatility";
export {
    fetchArExtremeMovesPeriodCustomers,
    fetchCustomerTrailingStaleSlopeVolatilityMetrics,
    fetchStaleSlopeVolatilityPeriodCustomers,
    fetchStaleSlopeVolatilityPeriodSummary,
    summarizePortfolioStaleSlopeVolatility,
    type CustomerStaleSlopeVolatilityRow,
    type FetchStaleSlopeVolatilityPeriodOptions,
    type PortfolioStaleSlopeVolatilitySummary,
} from "./credit-insurance/domain/staleSlopeVolatilityPeriod";
export {
    LIMIT_CAPPED_AR_CV_MIN,
    LIMIT_CAPPED_AR_GROWTH_MIN,
    LIMIT_CAPPED_COMPLIANT_CV_MAX,
    LIMIT_CAPPED_MIN_DAYS,
    computeCustomerOvershootLimitCappedMetrics,
    computeUtilizationOvershootMetrics,
    detectLimitCapped,
    rankCustomersByOvershoot,
    summarizePortfolioOvershoot,
    utilizationOvershootPts,
    type CtpLimitCappedDayPoint,
    type CtpUtilizationDayPoint,
    type CustomerOvershootLimitCappedMetrics,
    type CustomerOvershootLimitCappedRow,
    type LimitCappedDetectionResult,
    type LimitCappedNormalizedPoint,
    type LimitCappedThresholds,
    type PortfolioOvershootSummary,
    type UtilizationOvershootMetrics,
} from "./credit-insurance/domain/shared/ctpOvershootLimitCappedMetrics";
export {
    fetchCustomerTrailingOvershootLimitCappedMetrics,
    fetchLimitCappedPeriodCustomers,
    fetchOvershootLimitCappedPeriodCustomers,
    fetchOvershootLimitCappedPeriodSummary,
    fetchOvershootRankingPeriodCustomers,
    type FetchOvershootLimitCappedPeriodOptions,
} from "./credit-insurance/domain/overshootLimitCappedPeriod";
export {
    NEGATIVE_COST_MIN_MAGNITUDE,
    collectNegativeCostEntries,
    resolveNegativeCostFlag,
    summarizeCustomerNegativeCosts,
    summarizePortfolioNegativeCosts,
    type CustomerNegativeCostSummary,
    type NegativeCostEntryInput,
    type NegativeCostFlaggedEntry,
    type NegativeCostThresholds,
    type PortfolioNegativeCostSummary,
} from "./credit-insurance/domain/shared/ctpNegativeCostMetrics";
export {
    fetchNegativeCostPeriod,
    fetchNegativeCostPeriodCustomers,
    fetchNegativeCostPeriodSummary,
    type FetchNegativeCostPeriodOptions,
    type NegativeCostPeriodResult,
} from "./credit-insurance/domain/negativeCostPeriod";
export {
    RECONCILIATION_ABS_DELTA_EPSILON,
    collectExposureReconciliationFailures,
    evaluateExposureReconciliation,
    summarizeCustomerExposureReconciliation,
    summarizePortfolioExposureReconciliation,
    type CustomerExposureReconciliationSummary,
    type ExposureReconciliationFlaggedRow,
    type ExposureReconciliationInput,
    type PortfolioExposureReconciliationSummary,
    type ReconciliationThresholds,
} from "./credit-insurance/domain/shared/ctpExposureReconciliationMetrics";
export {
    fetchExposureReconciliationPeriod,
    fetchExposureReconciliationPeriodCustomers,
    fetchExposureReconciliationPeriodSummary,
    type ExposureReconciliationPeriodResult,
    type FetchExposureReconciliationPeriodOptions,
} from "./credit-insurance/domain/exposureReconciliationPeriod";
export {
    CONCENTRATION_ALERT_TOP1_PCT,
    computeCustomerShareOfPolicyOpenAr,
    computePolicyConcentrationMetrics,
    type PolicyConcentrationCustomerInput,
    type PolicyConcentrationMetrics,
    type PolicyConcentrationRankedCustomer,
    type PolicyConcentrationThresholds,
} from "./credit-insurance/domain/shared/ctpPolicyConcentrationMetrics";
export {
    fetchCustomerShareOfPolicyOpenAr,
    fetchPolicyConcentrationRankingRows,
    fetchPolicyConcentrationSnapshots,
    type FetchPolicyConcentrationOptions,
    type PolicyConcentrationSnapshotRow,
} from "./credit-insurance/domain/policyConcentrationPeriod";
export {
    LIMIT_BREACH_FORECAST_MAX_HORIZON_DAYS,
    LIMIT_BREACH_FORECAST_MIN_DAYS,
    LIMIT_BREACH_FORECAST_R2_FLOOR,
    LIMIT_BREACH_FORECAST_THRESHOLDS,
    LIMIT_BREACH_FORECAST_TRAILING_DAYS,
    computeLimitBreachForecast,
    hasProjectedLimitBreach,
    type LimitBreachForecastOptions,
    type LimitBreachForecastResult,
    type LimitBreachForecastStatus,
    type LimitBreachThresholdForecast,
} from "./credit-insurance/domain/shared/ctpLimitBreachForecastMetrics";
export {
    fetchCustomerTrailingLimitBreachForecast,
    fetchLimitBreachForecastPeriodCustomers,
    fetchProjectedLimitBreachCustomers,
    type CustomerLimitBreachForecastRow,
    type FetchLimitBreachForecastOptions,
} from "./credit-insurance/domain/limitBreachForecastPeriod";
export {
    BREACH_DILUTION_AR_GROWTH_MIN,
    BREACH_DILUTION_HEALTH_RISE_MIN_PTS,
    BREACH_DILUTION_MIN_DAYS,
    BREACH_PERSISTENT_MAX_DECLINE,
    BREACH_RESOLVED_MIN_DECLINE,
    classifyBreachDilution,
    computeBreachStreakMetrics,
    computeCustomerBreachDilutionStreakMetrics,
    formatBreachEpisodesSummary,
    isTermsBreachDay,
    latestBreachEpisode,
    mergeBreachDayPoints,
    rankDilutedCustomers,
    summarizePortfolioBreachDilutionStreak,
    type BreachDilutionClassification,
    type BreachDilutionMetrics,
    type BreachDilutionThresholds,
    type BreachEpisode,
    type BreachStreakMetrics,
    type BreachStreakStatus,
    type CtpBreachDayPoint,
    type CustomerBreachDilutionStreakMetrics,
    type CustomerBreachDilutionStreakRow,
    type PortfolioBreachDilutionStreakSummary,
} from "./credit-insurance/domain/shared/ctpBreachDilutionStreakMetrics";
export {
    breachEpisodeReportFields,
    fetchBreachDilutionStreakPeriodCustomers,
    fetchBreachDilutionStreakPeriodSummary,
    fetchBreachEpisodePeriodCustomers,
    fetchCustomerTrailingBreachDilutionStreakMetrics,
    fetchDilutedBreachPeriodCustomers,
    type BreachDilutionStreakPeriodResult,
    type FetchBreachDilutionStreakPeriodOptions,
} from "./credit-insurance/domain/breachDilutionStreakPeriod";
export {
    computeGapInBaseCurrency,
    freezeCustomerPolicyGapOnDeactivation,
    recomputeGapInBaseCurrencyForCustomer,
    syncCustomerPolicyGapAmountsForCustomer,
} from "./credit-insurance/domain/syncCustomerPolicyGapAmounts";
export {
    ensureCustomerCapacityGapStored,
    syncCreditInsuranceGapPipelineForCustomer,
} from "./credit-insurance/domain/syncCreditInsuranceGapPipeline";

// --- Bucket 1 CTP overshoot / limit-capped (Portfolio Health Utilization) ---
export {
    fetchOvershootLimitCappedPeriodSummary,
    fetchOvershootRankingPeriodCustomers,
    fetchLimitCappedPeriodCustomers,
    type FetchOvershootLimitCappedPeriodOptions,
} from "./credit-insurance/domain/overshootLimitCappedPeriod";
export type {
    CustomerOvershootLimitCappedRow,
    PortfolioOvershootSummary,
} from "./credit-insurance/domain/shared/ctpOvershootLimitCappedMetrics";
