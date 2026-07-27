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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RolesService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const database_service_1 = require("../database/database.service");
const permissions_service_1 = require("../permissions/permissions.service");
const ALL_ROLES = [
    "System_Administrator",
    "archaser_admin",
    "Collection_Manager",
    "Account_Manager",
    "Collection_Agent",
    "Data_Analyst",
    "Customer_Service_Representative",
    "IT_Support",
    "Bookkeeper",
    "CFO",
    "Auditor",
];
let RolesService = class RolesService {
    constructor(db, accessScope, permissions) {
        this.db = db;
        this.accessScope = accessScope;
        this.permissions = permissions;
    }
    resolveTargetAccountId(userInfo, requestedAccountId) {
        if (requestedAccountId &&
            this.accessScope.isAdminAccount(userInfo.accountId)) {
            return requestedAccountId;
        }
        return this.accessScope.getEffectiveAccountId(userInfo);
    }
    async listRoles(user, accountIdQuery) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId = accountIdQuery
            ? parseInt(accountIdQuery, 10)
            : null;
        const accountId = this.resolveTargetAccountId(userInfo, Number.isFinite(requestedAccountId) ? requestedAccountId : null);
        const baseRoles = ALL_ROLES.filter((r) => r !== "archaser_admin");
        let rolesToProcess = accountId === 10013 ? [...ALL_ROLES] : [...baseRoles];
        if (accountId !== 10013) {
            const account = await this.db.account.findUnique({
                where: { id: accountId },
                select: {
                    has_collection: true,
                    has_credit_insurance: true,
                },
            });
            const hasCollection = account
                ?.has_collection !== undefined
                ? Boolean(account
                    .has_collection)
                : true;
            const hasCreditInsurance = Boolean(account
                ?.has_credit_insurance);
            const masterRolePermissions = await this.db.rolePermission.findMany({
                where: { account_id: 10013 },
                select: {
                    role: true,
                    is_collection: true,
                    is_credit_insurance: true,
                },
                distinct: ["role"],
            });
            const eligibleRoles = new Set();
            for (const row of masterRolePermissions) {
                const collectionEnabled = row.is_collection !== false;
                const creditEnabled = row.is_credit_insurance === true;
                if ((hasCollection && collectionEnabled) ||
                    (hasCreditInsurance && creditEnabled)) {
                    eligibleRoles.add(row.role);
                }
            }
            rolesToProcess = baseRoles.filter((role) => eligibleRoles.has(role));
        }
        const rolesWithCounts = await Promise.all(rolesToProcess.map(async (role) => {
            const permissions = await this.permissions.getRolePermissions(accountId, role);
            return { role, permissionCount: permissions.length };
        }));
        const filteredRoles = rolesWithCounts.filter((r) => r.role !== "archaser_admin" || accountId === 10013);
        return { roles: filteredRoles };
    }
    async getRole(user, role, accountIdQuery) {
        if (!role) {
            throw new common_1.BadRequestException({ error: "Role is required" });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId = accountIdQuery
            ? parseInt(accountIdQuery, 10)
            : null;
        const accountId = this.resolveTargetAccountId(userInfo, Number.isFinite(requestedAccountId) ? requestedAccountId : null);
        const permissions = await this.permissions.getRolePermissions(accountId, role);
        return {
            role,
            permissions,
            permissionCount: permissions.length,
        };
    }
    async updateRole(user, role, body, accountIdQuery) {
        if (!role) {
            throw new common_1.BadRequestException({ error: "Role is required" });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId = accountIdQuery != null
            ? parseInt(accountIdQuery, 10)
            : body.accountId != null
                ? Number(body.accountId)
                : null;
        let accountId = this.accessScope.getEffectiveAccountId(userInfo);
        if (requestedAccountId &&
            this.accessScope.isAdminAccount(userInfo.accountId)) {
            accountId = requestedAccountId;
        }
        const isSystemAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        const userPermissions = await this.permissions.getRolePermissions(userInfo.accountId, userInfo.role);
        const hasManage = userPermissions.includes("manage_security_role");
        if (!isSystemAdmin && !hasManage) {
            throw new common_1.ForbiddenException({
                error: "You do not have permission to manage role permissions",
            });
        }
        if (!isSystemAdmin && accountId !== userInfo.accountId) {
            throw new common_1.ForbiddenException({
                error: "You can only edit role permissions for your own account",
            });
        }
        if (accountId === 10013 && role === "archaser_admin") {
            throw new common_1.ForbiddenException({
                error: "Cannot modify permissions for archaser_admin role on system account",
            });
        }
        const { permissions } = body;
        if (!Array.isArray(permissions)) {
            throw new common_1.BadRequestException({
                error: "Permissions must be an array",
            });
        }
        await this.permissions.updateRolePermissions(accountId, role, permissions, userInfo.userId);
        return {
            message: "Role permissions updated successfully",
            role,
            permissions,
        };
    }
};
exports.RolesService = RolesService;
exports.RolesService = RolesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService,
        permissions_service_1.PermissionsService])
], RolesService);
//# sourceMappingURL=roles.service.js.map