import { AccessScopeService, AccessUserInfo } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class CreditDashboardBuAccessDeniedError extends Error {
    constructor();
}
export type CreditDashboardAccessContext = {
    userInfo: AccessUserInfo;
    accountId: number;
    role: string;
    isAdmin: boolean;
    businessUnitFilter: Record<string, unknown>;
    selectedBusinessUnitId: number | null;
    accessibleBusinessUnitIds: number[] | null;
};
export type CreditDashboardAccessMode = "dashboard" | "insurance-policy-trend";
export declare class CreditDashboardAccessService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    authorize(user: JwtPayload, query?: Record<string, unknown>, mode?: CreditDashboardAccessMode): Promise<CreditDashboardAccessContext>;
    private hasInsurancePolicyTrendAccess;
    private parseBusinessUnitIdParam;
    private resolveDashboardBusinessUnitFilter;
    private getAccessibleBusinessUnitIds;
}
