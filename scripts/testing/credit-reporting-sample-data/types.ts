export type ScriptConfig = {
    confirm: boolean;
    dryRun: boolean;
    verify: boolean;
    repairKpis: boolean;
    days: number;
    resumeFrom?: string;
    customers: number;
    invoicesPerCustomer: number;
    usdCustomerPct: number;
};

export type HistoryWindow = {
    windowDays: number;
    windowStart: Date;
    windowEnd: Date;
    policyStart: Date;
    policyEnd: Date;
};

export type PlannedCounts = {
    customers: number;
    invoices: number;
    topUps: number;
    currencyRates: number;
    customerPolicyTrends: number;
    insurancePolicyTrends: number;
    creditDashboardSnapshots: number;
};

export type CheckpointData = {
    accountId: number;
    subdomain: string;
    lastCompletedDay: string | null;
    windowStart: string;
    windowDays: number;
};

export type AccountBootstrapResult = {
    accountId: number;
    subdomain: string;
    createdAccount: boolean;
    createdAdminUser: boolean;
    adminEmail: string;
    adminPassword: string;
    primaryPolicyId: number;
    topUpPolicyId: number;
    businessUnitIds: number[];
};

export type CustomerScenario =
    | "compliant"
    | "gap"
    | "breach-mep"
    | "breach-reporting"
    | "breach-outdated-dcl"
    | "breach-post-policy-end"
    | "excluded"
    | "zero-limit"
    | "no-policy";

export type CurrencyProfile = "ILS-primary" | "USD-primary";

export type ScheduledCustomer = {
    index: number;
    customerNumber: string;
    createDate: Date;
    dayIndex: number;
    clientType: "Company" | "Person";
    scenario: CustomerScenario;
    currencyProfile: CurrencyProfile;
    businessUnitIndex: 0 | 1;
    approvedLimit: number;
    approvedLimitCurrency: "ILS" | "USD";
};

export type ScenarioBreakdown = Record<CustomerScenario, number> & {
    ilsPrimary: number;
    usdPrimary: number;
    primaryBu: number;
    secondaryBu: number;
};

export type TopUpWindowKind =
    | "full-half-year"
    | "expiring-30d"
    | "expiring-7d";

export type ScheduledTopUp = {
    customerIndex: number;
    waveDayIndex: number;
    topUpType: "Fixed" | "Percentage";
    topUpValue: number;
    currency: "ILS" | "USD" | null;
    windowKind: TopUpWindowKind;
    isCapBuster: boolean;
};

export type ScheduledInvoice = {
    customerIndex: number;
    invoiceSlot: number;
    invoiceNumber: string;
    /** Day index (0-based) when the invoice row is inserted. */
    openDayIndex: number;
    /** Day index for invoice_date. */
    invoiceDateDayIndex: number;
    /** Day index for due_date. */
    dueDateDayIndex: number;
    customerAmount: number;
    invoiceCurrency: "ILS" | "USD";
    paymentTermDays: number;
    /** Fraction of customer outstanding to pay (0–1), if scheduled. */
    partialPaymentFraction?: number;
    /** Day index when partial payment is applied. */
    paymentDayIndex?: number;
};

export type ScheduledPayment = {
    customerIndex: number;
    invoiceNumber: string;
    paymentDayIndex: number;
    customerAmount: number;
    invoiceCurrency: "ILS" | "USD";
};

export type InvoiceScheduleBreakdown = {
    total: number;
    withPartialPayment: number;
    ilsCurrency: number;
    usdCurrency: number;
};

export type TopUpBreakdown = {
    total: number;
    fixed: number;
    percentage: number;
    capBusters: number;
    fullHalfYear: number;
    expiring30d: number;
    expiring7d: number;
    waveDays: number[];
};

export type EventSchedule = {
    customers: ScheduledCustomer[];
    customersByDay: Map<string, ScheduledCustomer[]>;
    topUps: ScheduledTopUp[];
    topUpsByDay: Map<string, ScheduledTopUp[]>;
    invoices: ScheduledInvoice[];
    invoicesByDay: Map<string, ScheduledInvoice[]>;
    paymentsByDay: Map<string, ScheduledPayment[]>;
    invoiceBreakdown: InvoiceScheduleBreakdown;
    breakdown: ScenarioBreakdown;
    topUpBreakdown: TopUpBreakdown;
    onboardingDays: number;
    targetCustomerCount: number;
    targetInvoiceCount: number;
};

export type CustomerOnboardingResult = {
    customerId: number;
    customerNumber: string;
    scheduled: ScheduledCustomer;
};

export type DayInsertCounts = {
    customers: number;
    invoices: number;
    payments: number;
    topUps: number;
};

export type DayLoopSummary = {
    daysProcessed: number;
    daysSkipped: number;
    customersCreated: number;
    topUpsCreated: number;
    invoicesCreated: number;
    paymentsCreated: number;
    gapSyncRuns: number;
    missingRateGapSyncs: number;
    customerPolicyTrendRows: number;
    insurancePolicyTrendRows: number;
    dashboardSnapshotScopes: number;
    breakdown: ScenarioBreakdown;
    topUpBreakdown: TopUpBreakdown;
    finalPassCustomersSynced: number;
    finalPassMissingRateCount: number;
};

export type PostRunSummary = {
    accountId: number;
    subdomain: string;
    adminEmail: string;
    adminPassword: string;
    windowStart: string;
    windowEnd: string;
    windowDays: number;
    customers: number;
    invoices: number;
    invoicePayments: number;
    customerTopUps: number;
    customerPolicyTrends: number;
    insurancePolicyTrends: number;
    creditDashboardSnapshots: number;
    scenarioBreakdown: ScenarioBreakdown;
    topUpBreakdown: TopUpBreakdown;
    peakCapBusterCoverIls: number | null;
    peakCapBusterDay: string | null;
};

export type WipeStats = {
    creditDashboardSnapshots: number;
    customerPolicyTrends: number;
    insurancePolicyTrends: number;
    insurancePolicyCountryTrends: number;
    namedPolicyTrends: number;
    customerCheckpoints: number;
    invoicePayments: number;
    invoices: number;
    customers: number;
    companies: number;
    persons: number;
};
