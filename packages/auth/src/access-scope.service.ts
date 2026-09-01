import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AUTH_DATABASE, AuthDatabase } from "./auth-database";
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

const ADMIN_ACCOUNT_ID = 10013;

/**
 * Account / owner / BU filtering for Nest domain services (no Next getToken).
 */
@Injectable()
export class AccessScopeService {
    constructor(
        @Inject(AUTH_DATABASE) private readonly db: AuthDatabase
    ) {}

    isAdminAccount(accountId: number): boolean {
        return accountId === ADMIN_ACCOUNT_ID;
    }

    getEffectiveUserId(userInfo: AccessUserInfo): string {
        return userInfo.viewAsUserId || userInfo.userId;
    }

    getEffectiveAccountId(userInfo: AccessUserInfo): number {
        return userInfo.viewAsUserAccountId || userInfo.accountId;
    }

    /**
     * Build AccessUserInfo from DualAuth JWT (+ DB hydration for BU / view-as).
     */
    async resolveUserInfo(user: JwtPayload): Promise<AccessUserInfo> {
        const userId = user.sub;
        if (!userId || user.account_id == null) {
            throw new UnauthorizedException("Unauthorized");
        }

        const dbUser = await this.db.user.findUnique({
            where: { id: userId },
            select: {
                business_unit_id: true,
                role: true,
                account_id: true,
            },
        });

        let viewAsUserId: string | undefined;
        let viewAsUserRole: string | undefined;
        let viewAsUserAccountId: number | undefined;
        let businessUnitId: number | null =
            dbUser?.business_unit_id ?? null;

        // Optional view-as claim if present on extended payloads
        const extended = user as JwtPayload & {
            view_as_user_id?: string;
            view_as_user_role?: string;
            view_as_user_account_id?: number;
        };
        if (extended.view_as_user_id) {
            viewAsUserId = extended.view_as_user_id;
            if (
                extended.view_as_user_role &&
                extended.view_as_user_account_id != null
            ) {
                viewAsUserRole = extended.view_as_user_role;
                viewAsUserAccountId = extended.view_as_user_account_id;
            } else {
                const viewAs = await this.db.user.findUnique({
                    where: { id: extended.view_as_user_id },
                    select: {
                        role: true,
                        account_id: true,
                        business_unit_id: true,
                    },
                });
                viewAsUserRole = viewAs?.role ?? undefined;
                viewAsUserAccountId = viewAs?.account_id ?? undefined;
                businessUnitId = viewAs?.business_unit_id ?? null;
            }
            if (viewAsUserId && businessUnitId === dbUser?.business_unit_id) {
                const viewAsBu = await this.db.user.findUnique({
                    where: { id: viewAsUserId },
                    select: { business_unit_id: true },
                });
                businessUnitId = viewAsBu?.business_unit_id ?? null;
            }
        }

        return {
            userId,
            accountId: user.account_id,
            role: user.role || dbUser?.role || "Auditor",
            viewAsUserId,
            viewAsUserRole,
            viewAsUserAccountId,
            businessUnitId,
        };
    }

    async hasPermission(
        accountId: number,
        role: string,
        permission: string
    ): Promise<boolean> {
        if (role === "System_Administrator") {
            return true;
        }
        if (accountId === ADMIN_ACCOUNT_ID && role === "archaser_admin") {
            return true;
        }
        try {
            const row = await this.db.rolePermission.findUnique({
                where: {
                    account_id_role_permission_key: {
                        account_id: accountId,
                        role: role as never,
                        permission_key: permission,
                    },
                },
            });
            return !!row;
        } catch {
            return false;
        }
    }

    async getOwnerFilter(
        userId: string,
        hasViewAsPermission: boolean,
        viewAsUserId?: string,
        viewAsUserRole?: string,
        viewAsUserAccountId?: number
    ): Promise<PrismaWhere> {
        if (!userId) {
            return {};
        }

        if (viewAsUserId && viewAsUserRole && viewAsUserAccountId != null) {
            const viewAsHas = await this.hasPermission(
                viewAsUserAccountId,
                viewAsUserRole,
                "use_view_as"
            );
            if (viewAsHas) {
                return {};
            }
            return {
                OR: [{ owner_id: viewAsUserId }, { owner_id: null }],
            };
        }

        if (hasViewAsPermission) {
            return {};
        }

        return {
            OR: [{ owner_id: userId }, { owner_id: null }],
        };
    }

    async getBusinessUnitHierarchy(buId: number): Promise<number[]> {
        const descendantIds: number[] = [];
        const visited = new Set<number>();

        const walk = async (id: number) => {
            if (visited.has(id)) {
                return;
            }
            visited.add(id);
            const children = await this.db.businessUnit.findMany({
                where: { parent_id: id },
                select: { id: true },
            });
            for (const child of children) {
                descendantIds.push(child.id);
                await walk(child.id);
            }
        };

        await walk(buId);
        return descendantIds;
    }

    async getBusinessUnitFilter(
        userBuId: number | null | undefined,
        isAdmin: boolean,
        accountId?: number
    ): Promise<PrismaWhere> {
        if (isAdmin) {
            return {};
        }
        if (!userBuId) {
            return { id: -1 };
        }

        const descendantIds = await this.getBusinessUnitHierarchy(userBuId);
        let includeNullBU = false;
        if (accountId) {
            const userBU = await this.db.businessUnit.findUnique({
                where: { id: userBuId },
                select: { is_primary: true, account_id: true },
            });
            includeNullBU =
                userBU?.is_primary === true && userBU.account_id === accountId;
        }

        const conditions: PrismaWhere[] = [{ business_unit_id: userBuId }];
        if (descendantIds.length > 0) {
            conditions.push({ business_unit_id: { in: descendantIds } });
        }
        if (includeNullBU) {
            conditions.push({ business_unit_id: null });
        }
        return { OR: conditions };
    }

    /**
     * Filter for listing users by BU (mirrors AccessControlService.getUserBusinessUnitFilter).
     */
    async getUserBusinessUnitFilter(
        userBuId: number | null | undefined,
        isAdmin: boolean,
        includeNullBU = false
    ): Promise<PrismaWhere> {
        if (isAdmin) {
            return {};
        }
        if (!userBuId) {
            return { business_unit_id: null };
        }

        const descendantIds = await this.getBusinessUnitHierarchy(userBuId);
        const conditions: PrismaWhere[] = [{ business_unit_id: userBuId }];
        if (descendantIds.length > 0) {
            conditions.push({ business_unit_id: { in: descendantIds } });
        }
        if (includeNullBU) {
            conditions.push({ business_unit_id: null });
        }
        return { OR: conditions };
    }

    /**
     * Customer-list style AND clauses for account + owner + BU.
     */
    async buildCustomerAccessWhere(
        userInfo: AccessUserInfo
    ): Promise<PrismaWhere[]> {
        const isAdmin = this.isAdminAccount(userInfo.accountId);
        const accountId = this.getEffectiveAccountId(userInfo);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const hasViewAs = await this.hasPermission(
            accountId,
            effectiveRole,
            "use_view_as"
        );

        const ownerFilter = isAdmin
            ? {}
            : await this.getOwnerFilter(
                  userInfo.userId,
                  hasViewAs,
                  userInfo.viewAsUserId,
                  userInfo.viewAsUserRole,
                  userInfo.viewAsUserAccountId
              );

        const buFilter = await this.getBusinessUnitFilter(
            userInfo.businessUnitId,
            isAdmin,
            accountId
        );

        const parts: PrismaWhere[] = [{ account_id: accountId }];
        if (Object.keys(ownerFilter).length > 0) {
            parts.push(ownerFilter);
        }
        if (Object.keys(buFilter).length > 0) {
            parts.push(buFilter);
        }
        return parts;
    }
}
