/**
 * Daily insurance policy status maintenance:
 * - Deactivate expired Primary policies
 * - Deactivate Active Primary policies before start_date
 * - Activate scheduled Inactive Primary policies (auto_activate_on_term_start)
 * - Sync TopUp policy status with parent effective status
 */
export declare function runInsurancePolicyStatusMaintenance(): Promise<{
    policiesDeactivated: number;
    policiesPrematureDeactivated: number;
    policiesActivated: number;
    topUpsDeactivated: number;
    topUpsActivated: number;
}>;
/** @deprecated Use runInsurancePolicyStatusMaintenance */
export declare function deactivateExpiredInsurancePolicies(): Promise<{
    policiesDeactivated: number;
}>;
