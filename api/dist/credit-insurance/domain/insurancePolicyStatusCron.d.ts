export declare function runInsurancePolicyStatusMaintenance(): Promise<{
    policiesDeactivated: number;
    policiesPrematureDeactivated: number;
    policiesActivated: number;
    topUpsDeactivated: number;
    topUpsActivated: number;
}>;
export declare function deactivateExpiredInsurancePolicies(): Promise<{
    policiesDeactivated: number;
}>;
