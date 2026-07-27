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
exports.PermissionsService = exports.ALL_PERMISSION_KEYS = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const database_service_1 = require("../database/database.service");
exports.ALL_PERMISSION_KEYS = [
    "import_customer",
    "import_invoice",
    "import_contact",
    "import_payment",
    "import_policy",
    "export_data",
    "manage_users",
    "view_users",
    "view_roles",
    "manage_security_role",
    "create_log_activity",
    "send_email",
    "view_follow_up_reminders",
    "manage_activity_sequence",
    "view_activity_sequences",
    "manage_sequence_container",
    "manage_business_units",
    "view_business_units",
    "view_settings",
    "view_system_logs",
    "use_view_as",
    "create_dispute",
    "assign_dispute",
    "resolve_dispute",
    "create_customer",
    "edit_customer",
    "delete_customer",
    "manage_contacts",
    "view_contacts",
    "view_templates",
    "edit_templates",
    "view_banks",
    "edit_bank_account",
    "create_invoice",
    "edit_invoice",
    "delete_invoice",
    "view_invoices",
    "view_operation_dashboard",
    "view_financial_dashboard",
    "view_credit_dashboard",
    "update_insurance_policy",
    "view_billing_connector",
    "manage_billing_connector",
    "view_reports",
    "create_report",
    "edit_report",
    "delete_report",
    "share_report",
    "schedule_report",
    "export_report",
];
const LOCKED_UAM_KEYS = [
    "manage_users",
    "view_users",
    "view_roles",
    "manage_security_role",
];
const ADMIN_ACCOUNT_ID = 10013;
const PERMISSIONS_BY_CATEGORY = {
    customer_data_management: {
        customers: ["create_customer", "edit_customer", "delete_customer"],
        contacts: ["view_contacts", "manage_contacts"],
    },
    collection_operations: {
        activities: [
            "create_log_activity",
            "send_email",
            "view_follow_up_reminders",
        ],
        disputes: ["create_dispute", "assign_dispute", "resolve_dispute"],
        sequences: [
            "view_activity_sequences",
            "manage_activity_sequence",
            "manage_sequence_container",
        ],
    },
    user_access_management: {
        users: ["view_users", "manage_users"],
        roles: ["view_roles", "manage_security_role"],
        special_access: ["use_view_as"],
    },
    system_configuration: {
        settings: [
            "view_settings",
            "view_system_logs",
            "update_insurance_policy",
            "view_billing_connector",
            "manage_billing_connector",
        ],
        business_units: ["view_business_units", "manage_business_units"],
        templates: ["view_templates", "edit_templates"],
        financial: ["view_banks", "edit_bank_account"],
    },
    analytics_reporting: {
        import_export: [
            "import_customer",
            "import_invoice",
            "import_contact",
            "import_payment",
            "import_policy",
            "export_data",
        ],
        reports: [
            "view_reports",
            "create_report",
            "edit_report",
            "delete_report",
            "share_report",
            "schedule_report",
            "export_report",
        ],
        dashboards: [
            "view_operation_dashboard",
            "view_financial_dashboard",
            "view_credit_dashboard",
        ],
    },
};
let PermissionsService = class PermissionsService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    getAllPermissionKeys() {
        return [...exports.ALL_PERMISSION_KEYS];
    }
    getPermissionsByCategory() {
        return JSON.parse(JSON.stringify(PERMISSIONS_BY_CATEGORY));
    }
    async getMyPermissions(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const effectiveAccountId = userInfo.viewAsUserAccountId || userInfo.accountId;
        const permissions = await this.getRolePermissions(effectiveAccountId, effectiveRole);
        return { permissions };
    }
    async getPermissionsMatrix(user, accountIdQuery) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId = accountIdQuery
            ? parseInt(accountIdQuery, 10)
            : null;
        let accountId = userInfo.viewAsUserAccountId || userInfo.accountId;
        if (requestedAccountId &&
            this.accessScope.isAdminAccount(userInfo.accountId)) {
            accountId = requestedAccountId;
        }
        let permissionsByCategory = this.getPermissionsByCategory();
        let allPermissions = this.getAllPermissionKeys();
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: {
                has_collection: true,
                has_credit_insurance: true,
            },
        });
        const hasCreditInsurance = account
            ?.has_credit_insurance === true;
        const isCreditOnlyAccount = account
            ?.has_collection === false && hasCreditInsurance;
        if (account && !hasCreditInsurance) {
            const creditOnly = new Set([
                "view_credit_dashboard",
                "update_insurance_policy",
            ]);
            allPermissions = allPermissions.filter((k) => !creditOnly.has(k));
            permissionsByCategory = this.filterCategoryKeys(permissionsByCategory, creditOnly);
        }
        if (isCreditOnlyAccount) {
            const restrictedKeys = new Set();
            const collectionOps = permissionsByCategory.collection_operations || {};
            Object.values(collectionOps).forEach((perms) => {
                perms.forEach((p) => restrictedKeys.add(p));
            });
            const dashboardPerms = permissionsByCategory.analytics_reporting?.dashboards || [];
            dashboardPerms.forEach((p) => {
                if (p !== "view_credit_dashboard") {
                    restrictedKeys.add(p);
                }
            });
            for (const extra of [
                "view_templates",
                "edit_templates",
                "view_banks",
                "edit_bank_account",
                "use_view_as",
            ]) {
                restrictedKeys.add(extra);
            }
            allPermissions = allPermissions.filter((key) => !restrictedKeys.has(key));
            const filtered = {};
            Object.entries(permissionsByCategory).forEach(([categoryKey, subcategories]) => {
                if (categoryKey === "collection_operations")
                    return;
                const nextSubs = {};
                Object.entries(subcategories).forEach(([subKey, perms]) => {
                    const filteredPerms = perms.filter((perm) => !restrictedKeys.has(perm));
                    if (filteredPerms.length > 0) {
                        nextSubs[subKey] = filteredPerms;
                    }
                });
                if (Object.keys(nextSubs).length > 0) {
                    filtered[categoryKey] = nextSubs;
                }
            });
            permissionsByCategory = filtered;
        }
        return {
            permissions: allPermissions,
            permissionsByCategory,
        };
    }
    async getPermissionsForRole(user, role, accountIdQuery) {
        if (!role) {
            throw new common_1.BadRequestException({ error: "Role is required" });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId = accountIdQuery
            ? parseInt(accountIdQuery, 10)
            : null;
        let accountId = userInfo.viewAsUserAccountId || userInfo.accountId;
        if (requestedAccountId &&
            this.accessScope.isAdminAccount(userInfo.accountId)) {
            accountId = requestedAccountId;
        }
        const permissions = await this.getRolePermissions(accountId, role);
        return { role, permissions };
    }
    async putPermissionsForRole(user, role, body, accountIdQuery) {
        if (!role) {
            throw new common_1.BadRequestException({ error: "Role is required" });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId = accountIdQuery != null
            ? parseInt(accountIdQuery, 10)
            : body.accountId != null
                ? Number(body.accountId)
                : null;
        let accountId = userInfo.viewAsUserAccountId || userInfo.accountId;
        if (requestedAccountId &&
            this.accessScope.isAdminAccount(userInfo.accountId)) {
            accountId = requestedAccountId;
        }
        const isSystemAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        const userPermissions = await this.getRolePermissions(userInfo.accountId, userInfo.role);
        if (!isSystemAdmin &&
            !userPermissions.includes("manage_security_role")) {
            throw new common_1.ForbiddenException({
                error: "You do not have permission to manage role permissions",
            });
        }
        if (!isSystemAdmin && accountId !== userInfo.accountId) {
            throw new common_1.ForbiddenException({
                error: "You can only edit role permissions for your own account",
            });
        }
        if (accountId === ADMIN_ACCOUNT_ID && role === "archaser_admin") {
            throw new common_1.ForbiddenException({
                error: "Cannot modify permissions for archaser_admin role on system account",
            });
        }
        if (!Array.isArray(body.permissions)) {
            throw new common_1.BadRequestException({
                error: "Permissions must be an array",
            });
        }
        await this.updateRolePermissions(accountId, role, body.permissions, userInfo.userId);
        return {
            message: "Role permissions updated successfully",
            role,
            permissions: body.permissions,
        };
    }
    async getRolePermissions(accountId, role) {
        if (!role) {
            return [];
        }
        if (role === "System_Administrator") {
            const rows = await this.db.rolePermission.findMany({
                where: {
                    account_id: accountId,
                    role: role,
                },
                select: { permission_key: true },
            });
            const dbKeys = rows.map((r) => r.permission_key);
            if (dbKeys.length === 0) {
                return [...exports.ALL_PERMISSION_KEYS];
            }
            return Array.from(new Set([...dbKeys, ...LOCKED_UAM_KEYS]));
        }
        if (accountId === ADMIN_ACCOUNT_ID && role === "archaser_admin") {
            return [...exports.ALL_PERMISSION_KEYS];
        }
        try {
            const rows = await this.db.rolePermission.findMany({
                where: {
                    account_id: accountId,
                    role: role,
                },
                select: { permission_key: true },
            });
            return rows.map((r) => r.permission_key);
        }
        catch {
            return [];
        }
    }
    async updateRolePermissions(accountId, role, permissions, userId) {
        if (!role) {
            throw new common_1.BadRequestException({ error: `Invalid role: ${role}` });
        }
        let permissionsToSave = permissions;
        if (role === "System_Administrator") {
            permissionsToSave = Array.from(new Set([...permissions, ...LOCKED_UAM_KEYS]));
        }
        if (accountId === ADMIN_ACCOUNT_ID && role === "archaser_admin") {
            throw new common_1.ForbiddenException({
                error: "Cannot modify permissions for archaser_admin role",
            });
        }
        const allPermissions = this.getAllPermissionKeys();
        await this.db.$transaction(async (tx) => {
            await tx.rolePermission.deleteMany({
                where: {
                    account_id: accountId,
                    role: role,
                    permission_key: { notIn: permissionsToSave },
                },
            });
            for (const permission of permissionsToSave) {
                if (!allPermissions.includes(permission)) {
                    continue;
                }
                await tx.rolePermission.upsert({
                    where: {
                        account_id_role_permission_key: {
                            account_id: accountId,
                            role: role,
                            permission_key: permission,
                        },
                    },
                    update: {
                        modified_by: userId,
                        modified_at: new Date(),
                    },
                    create: {
                        account_id: accountId,
                        role: role,
                        permission_key: permission,
                        created_by: userId,
                        modified_by: userId,
                    },
                });
            }
        });
    }
    filterCategoryKeys(categories, exclude) {
        const result = {};
        Object.entries(categories).forEach(([categoryKey, subcategories]) => {
            const nextSubs = {};
            Object.entries(subcategories).forEach(([subKey, perms]) => {
                const filtered = perms.filter((p) => !exclude.has(p));
                if (filtered.length > 0) {
                    nextSubs[subKey] = filtered;
                }
            });
            if (Object.keys(nextSubs).length > 0) {
                result[categoryKey] = nextSubs;
            }
        });
        return result;
    }
};
exports.PermissionsService = PermissionsService;
exports.PermissionsService = PermissionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], PermissionsService);
//# sourceMappingURL=permissions.service.js.map