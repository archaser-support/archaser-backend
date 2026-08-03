"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccessScopeService = void 0;
const common_1 = require("@nestjs/common");
const auth_database_1 = require("./auth-database");
const ADMIN_ACCOUNT_ID = 10013;
/**
 * Account / owner / BU filtering for Nest domain services (no Next getToken).
 */
let AccessScopeService = class AccessScopeService {
    constructor(db) {
        this.db = db;
    }
    isAdminAccount(accountId) {
        return accountId === ADMIN_ACCOUNT_ID;
    }
    getEffectiveUserId(userInfo) {
        return userInfo.viewAsUserId || userInfo.userId;
    }
    getEffectiveAccountId(userInfo) {
        return userInfo.viewAsUserAccountId || userInfo.accountId;
    }
    /**
     * Build AccessUserInfo from DualAuth JWT (+ DB hydration for BU / view-as).
     */
    async resolveUserInfo(user) {
        const userId = user.sub;
        if (!userId || user.account_id == null) {
            throw new Error("Unauthorized");
        }
        const dbUser = await this.db.user.findUnique({
            where: { id: userId },
            select: {
                business_unit_id: true,
                role: true,
                account_id: true,
            },
        });
        let viewAsUserId;
        let viewAsUserRole;
        let viewAsUserAccountId;
        let businessUnitId = dbUser?.business_unit_id ?? null;
        // Optional view-as claim if present on extended payloads
        const extended = user;
        if (extended.view_as_user_id) {
            viewAsUserId = extended.view_as_user_id;
            if (extended.view_as_user_role &&
                extended.view_as_user_account_id != null) {
                viewAsUserRole = extended.view_as_user_role;
                viewAsUserAccountId = extended.view_as_user_account_id;
            }
            else {
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
    async hasPermission(accountId, role, permission) {
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
                        role: role,
                        permission_key: permission,
                    },
                },
            });
            return !!row;
        }
        catch {
            return false;
        }
    }
    async getOwnerFilter(userId, hasViewAsPermission, viewAsUserId, viewAsUserRole, viewAsUserAccountId) {
        if (!userId) {
            return {};
        }
        if (viewAsUserId && viewAsUserRole && viewAsUserAccountId != null) {
            const viewAsHas = await this.hasPermission(viewAsUserAccountId, viewAsUserRole, "use_view_as");
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
    async getBusinessUnitHierarchy(buId) {
        const descendantIds = [];
        const visited = new Set();
        const walk = async (id) => {
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
    async getBusinessUnitFilter(userBuId, isAdmin, accountId) {
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
        const conditions = [{ business_unit_id: userBuId }];
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
    async getUserBusinessUnitFilter(userBuId, isAdmin, includeNullBU = false) {
        if (isAdmin) {
            return {};
        }
        if (!userBuId) {
            return { business_unit_id: null };
        }
        const descendantIds = await this.getBusinessUnitHierarchy(userBuId);
        const conditions = [{ business_unit_id: userBuId }];
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
    async buildCustomerAccessWhere(userInfo) {
        const isAdmin = this.isAdminAccount(userInfo.accountId);
        const accountId = this.getEffectiveAccountId(userInfo);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const hasViewAs = await this.hasPermission(accountId, effectiveRole, "use_view_as");
        const ownerFilter = isAdmin
            ? {}
            : await this.getOwnerFilter(userInfo.userId, hasViewAs, userInfo.viewAsUserId, userInfo.viewAsUserRole, userInfo.viewAsUserAccountId);
        const buFilter = await this.getBusinessUnitFilter(userInfo.businessUnitId, isAdmin, accountId);
        const parts = [{ account_id: accountId }];
        if (Object.keys(ownerFilter).length > 0) {
            parts.push(ownerFilter);
        }
        if (Object.keys(buFilter).length > 0) {
            parts.push(buFilter);
        }
        return parts;
    }
};
exports.AccessScopeService = AccessScopeService;
exports.AccessScopeService = AccessScopeService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(auth_database_1.AUTH_DATABASE)),
    __metadata("design:paramtypes", [Object])
], AccessScopeService);
