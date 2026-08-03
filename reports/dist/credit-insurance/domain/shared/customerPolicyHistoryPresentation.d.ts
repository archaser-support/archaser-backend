export type CustomerPolicyHistoryChipKind = "previous_policy" | "previous_version";
export type UserAuditDisplaySource = {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
} | null | undefined;
export declare function resolveUserAuditDisplayName(user: UserAuditDisplaySource): string | null;
export declare function resolveCustomerPolicyHistoryChipKind(args: {
    inactiveInsurancePolicyId: number | null | undefined;
    activeInsurancePolicyId: number | null | undefined;
}): CustomerPolicyHistoryChipKind | null;
export declare function buildPolicyHistoryHeaderAuditSegment(args: {
    modifiedAt: Date | string | null | undefined;
    modifiedByDisplayName: string | null | undefined;
    formatDate: (value: Date | string) => string;
}): string | null;
