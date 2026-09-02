import { AuthDatabase } from "./auth-database";
import { JwtPayload } from "./jwt-payload";
/** Nest-portable scope context (mirrors AccessControlService UserInfo). */
export interface AccessUserInfo {
    userId: string;
    accountId: number;
    role: string;
    viewAsUserId?: string;
    viewAsUserRole?: string;
    viewAsUserAccountId?: number;
    businessUnitId?: number | null;
}
export type PrismaWhere = Record<string, unknown>;
/**
 * Account / owner / BU filtering for Nest domain services (no Next getToken).
 */
export declare class AccessScopeService {
    private readonly db;
    constructor(db: AuthDatabase);
    isAdminAccount(accountId: number): boolean;
    getEffectiveUserId(userInfo: AccessUserInfo): string;
    getEffectiveAccountId(userInfo: AccessUserInfo): number;
    /**
     * Build AccessUserInfo from DualAuth JWT (+ DB hydration for BU / view-as).
     */
    resolveUserInfo(user: JwtPayload): Promise<AccessUserInfo>;
    hasPermission(accountId: number, role: string, permission: string): Promise<boolean>;
    getOwnerFilter(userId: string, hasViewAsPermission: boolean, viewAsUserId?: string, viewAsUserRole?: string, viewAsUserAccountId?: number): Promise<PrismaWhere>;
    getBusinessUnitHierarchy(buId: number): Promise<number[]>;
    getBusinessUnitFilter(userBuId: number | null | undefined, isAdmin: boolean, accountId?: number): Promise<PrismaWhere>;
    /**
     * Filter for listing users by BU (mirrors AccessControlService.getUserBusinessUnitFilter).
     */
    getUserBusinessUnitFilter(userBuId: number | null | undefined, isAdmin: boolean, includeNullBU?: boolean): Promise<PrismaWhere>;
    /**
     * Customer-list style AND clauses for account + owner + BU.
     */
    buildCustomerAccessWhere(userInfo: AccessUserInfo): Promise<PrismaWhere[]>;
}
