export type InsurancePolicyTrendPoint = {
    snapshotDate: string;
    policyNumber: string;
    status: string;
    maxTotalCover: number | null;
    costCalculationMethod: string | null;
    costPercent: number | null;
    activeCustomerCount: number;
    totalApprovedLimit: number | null;
    totalOpenAr: number;
    policyUsagePct: number | null;
    namedPolicyRowCount: number;
    countryRowCount: number;
};
export type InsurancePolicyTrendResponse = {
    policyId: number;
    fromDate: string | null;
    toDate: string | null;
    latest: InsurancePolicyTrendPoint | null;
    series: InsurancePolicyTrendPoint[];
};
export type InsurancePolicyCountryTrendPoint = {
    snapshotDate: string;
    countryId: number;
    insurancePolicyCountryId: string;
    paymentTermCap: number | null;
    countryMep: number | null;
    reportingDays: number | null;
    countryMaxLimit: number | null;
};
export type InsurancePolicyCountryTrendResponse = {
    policyId: number;
    countryId: number | null;
    fromDate: string | null;
    toDate: string | null;
    series: InsurancePolicyCountryTrendPoint[];
};
export type NamedPolicyTrendPoint = {
    snapshotDate: string;
    namedPolicyId: number;
    customerNumber: string;
    maxPaymentTerm: number | null;
    customerMep: number | null;
    reportingDays: number | null;
    customerMaxLimit: number | null;
    limitExpirationDate: string | null;
};
export type NamedPolicyTrendResponse = {
    policyId: number;
    namedPolicyId: number | null;
    customerNumber: string | null;
    fromDate: string | null;
    toDate: string | null;
    series: NamedPolicyTrendPoint[];
};
export type InsurancePolicyConfigChangeField = {
    field: string;
    previous: string | number | boolean | null;
    current: string | number | boolean | null;
};
export type InsurancePolicyConfigChangesResponse = {
    policyId: number;
    fromSnapshotDate: string | null;
    toSnapshotDate: string | null;
    headerChanges: InsurancePolicyConfigChangeField[];
    addedCountryIds: number[];
    removedCountryIds: number[];
    addedNamedPolicyIds: number[];
    removedNamedPolicyIds: number[];
};
export declare function computePolicyUsagePct(totalOpenAr: number, maxTotalCover: number | null): number | null;
export declare function syncInsurancePolicyTrendSnapshotForAccount(accountId: number, options?: {
    policyId?: number;
    snapshotDate?: Date;
}): Promise<{
    policyRowsUpserted: number;
    countryRowsUpserted: number;
    namedRowsUpserted: number;
}>;
export declare function takeInsurancePolicyTrendSnapshots(options?: {
    snapshotDate?: Date;
}): Promise<{
    accountsProcessed: number;
    policyRowsUpserted: number;
    countryRowsUpserted: number;
    namedRowsUpserted: number;
}>;
export declare function getInsurancePolicyTrend(accountId: number, policyId: number, options?: {
    days?: number;
}): Promise<InsurancePolicyTrendResponse>;
export declare function getInsurancePolicyCountryTrend(accountId: number, policyId: number, options?: {
    countryId?: number;
    days?: number;
}): Promise<InsurancePolicyCountryTrendResponse>;
export declare function getNamedPolicyTrend(accountId: number, policyId: number, options?: {
    namedPolicyId?: number;
    customerNumber?: string;
    days?: number;
}): Promise<NamedPolicyTrendResponse>;
export declare function getInsurancePolicyConfigChanges(accountId: number, policyId: number, options?: {
    fromDate?: string;
    toDate?: string;
}): Promise<InsurancePolicyConfigChangesResponse>;
