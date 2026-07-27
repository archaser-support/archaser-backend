import { DatabaseService } from "../database/database.service";
import { JwtPayload } from "./auth.service";
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
export declare class AccessScopeService {
    private readonly db;
    constructor(db: DatabaseService);
    isAdminAccount(accountId: number): boolean;
    getEffectiveUserId(userInfo: AccessUserInfo): string;
    getEffectiveAccountId(userInfo: AccessUserInfo): number;
    resolveUserInfo(user: JwtPayload): Promise<AccessUserInfo>;
    hasPermission(accountId: number, role: string, permission: string): Promise<boolean>;
    getOwnerFilter(userId: string, hasViewAsPermission: boolean, viewAsUserId?: string, viewAsUserRole?: string, viewAsUserAccountId?: number): Promise<PrismaWhere>;
    getBusinessUnitHierarchy(buId: number): Promise<number[]>;
    getBusinessUnitFilter(userBuId: number | null | undefined, isAdmin: boolean, accountId?: number): Promise<PrismaWhere>;
    getUserBusinessUnitFilter(userBuId: number | null | undefined, isAdmin: boolean, includeNullBU?: boolean): Promise<PrismaWhere>;
    buildCustomerAccessWhere(userInfo: AccessUserInfo): Promise<PrismaWhere[]>;
}
