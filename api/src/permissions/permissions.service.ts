import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";

/** Mirrors PermissionService.getAllPermissionKeys (UI + RBAC catalog). */
export const ALL_PERMISSION_KEYS: string[] = [
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

const PERMISSIONS_BY_CATEGORY: Record<string, Record<string, string[]>> = {
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

@Injectable()
export class PermissionsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    getAllPermissionKeys(): string[] {
        return [...ALL_PERMISSION_KEYS];
    }

    getPermissionsByCategory(): Record<string, Record<string, string[]>> {
        return JSON.parse(JSON.stringify(PERMISSIONS_BY_CATEGORY));
    }

    async getMyPermissions(
        user: JwtPayload
    ): Promise<{ permissions: string[] }> {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const effectiveAccountId =
            userInfo.viewAsUserAccountId || userInfo.accountId;

        const permissions = await this.getRolePermissions(
            effectiveAccountId,
            effectiveRole
        );
        return { permissions };
    }

    async getPermissionsMatrix(
        user: JwtPayload,
        accountIdQuery?: string
    ): Promise<{
        permissions: string[];
        permissionsByCategory: Record<string, Record<string, string[]>>;
    }> {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId = accountIdQuery
            ? parseInt(accountIdQuery, 10)
            : null;

        let accountId = userInfo.viewAsUserAccountId || userInfo.accountId;
        if (
            requestedAccountId &&
            this.accessScope.isAdminAccount(userInfo.accountId)
        ) {
            accountId = requestedAccountId;
        }

        return this.getFilteredPermissionCatalog(accountId);
    }

    /**
     * Product-aware permissions catalog for an account (same rules as the
     * matrix UI). Used by getPermissionsMatrix and to preserve hidden grants
     * when roles are saved while a product flag is off.
     */
    private async getFilteredPermissionCatalog(accountId: number): Promise<{
        permissions: string[];
        permissionsByCategory: Record<string, Record<string, string[]>>;
    }> {
        let permissionsByCategory = this.getPermissionsByCategory();
        let allPermissions = this.getAllPermissionKeys();

        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: {
                has_collection: true,
                has_credit_insurance: true,
                has_file_import: true,
            } as never,
        });

        const hasCreditInsurance =
            (account as { has_credit_insurance?: boolean } | null)
                ?.has_credit_insurance === true;
        const isCreditOnlyAccount =
            (account as { has_collection?: boolean } | null)
                ?.has_collection === false && hasCreditInsurance;
        const hasFileImport =
            (account as { has_file_import?: boolean } | null)
                ?.has_file_import !== false;

        if (account && !hasCreditInsurance) {
            const creditOnly = new Set([
                "view_credit_dashboard",
                "update_insurance_policy",
            ]);
            allPermissions = allPermissions.filter((k) => !creditOnly.has(k));
            permissionsByCategory = this.filterCategoryKeys(
                permissionsByCategory,
                creditOnly
            );
        }

        if (account && !hasFileImport) {
            const importKeys = new Set(
                ALL_PERMISSION_KEYS.filter((k) => k.startsWith("import_"))
            );
            allPermissions = allPermissions.filter((k) => !importKeys.has(k));
            permissionsByCategory = this.filterCategoryKeys(
                permissionsByCategory,
                importKeys
            );
        }

        if (isCreditOnlyAccount) {
            const restrictedKeys = new Set<string>();
            const collectionOps =
                permissionsByCategory.collection_operations || {};
            Object.values(collectionOps).forEach((perms) => {
                perms.forEach((p) => restrictedKeys.add(p));
            });
            const dashboardPerms =
                permissionsByCategory.analytics_reporting?.dashboards || [];
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

            allPermissions = allPermissions.filter(
                (key) => !restrictedKeys.has(key)
            );

            const filtered: Record<string, Record<string, string[]>> = {};
            Object.entries(permissionsByCategory).forEach(
                ([categoryKey, subcategories]) => {
                    if (categoryKey === "collection_operations") return;
                    const nextSubs: Record<string, string[]> = {};
                    Object.entries(subcategories).forEach(([subKey, perms]) => {
                        const filteredPerms = perms.filter(
                            (perm) => !restrictedKeys.has(perm)
                        );
                        if (filteredPerms.length > 0) {
                            nextSubs[subKey] = filteredPerms;
                        }
                    });
                    if (Object.keys(nextSubs).length > 0) {
                        filtered[categoryKey] = nextSubs;
                    }
                }
            );
            permissionsByCategory = filtered;
        }

        return {
            permissions: allPermissions,
            permissionsByCategory,
        };
    }

    async getPermissionsForRole(
        user: JwtPayload,
        role: string,
        accountIdQuery?: string
    ): Promise<{ role: string; permissions: string[] }> {
        if (!role) {
            throw new BadRequestException({ error: "Role is required" });
        }

        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId = accountIdQuery
            ? parseInt(accountIdQuery, 10)
            : null;

        let accountId = userInfo.viewAsUserAccountId || userInfo.accountId;
        if (
            requestedAccountId &&
            this.accessScope.isAdminAccount(userInfo.accountId)
        ) {
            accountId = requestedAccountId;
        }

        const permissions = await this.getRolePermissions(accountId, role);
        return { role, permissions };
    }

    async putPermissionsForRole(
        user: JwtPayload,
        role: string,
        body: { permissions?: string[]; accountId?: number },
        accountIdQuery?: string
    ) {
        if (!role) {
            throw new BadRequestException({ error: "Role is required" });
        }

        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId =
            accountIdQuery != null
                ? parseInt(accountIdQuery, 10)
                : body.accountId != null
                  ? Number(body.accountId)
                  : null;

        let accountId = userInfo.viewAsUserAccountId || userInfo.accountId;
        if (
            requestedAccountId &&
            this.accessScope.isAdminAccount(userInfo.accountId)
        ) {
            accountId = requestedAccountId;
        }

        const isSystemAdmin = this.accessScope.isAdminAccount(
            userInfo.accountId
        );
        const userPermissions = await this.getRolePermissions(
            userInfo.accountId,
            userInfo.role
        );
        if (
            !isSystemAdmin &&
            !userPermissions.includes("manage_security_role")
        ) {
            throw new ForbiddenException({
                error: "You do not have permission to manage role permissions",
            });
        }
        if (!isSystemAdmin && accountId !== userInfo.accountId) {
            throw new ForbiddenException({
                error: "You can only edit role permissions for your own account",
            });
        }
        if (accountId === ADMIN_ACCOUNT_ID && role === "archaser_admin") {
            throw new ForbiddenException({
                error: "Cannot modify permissions for archaser_admin role on system account",
            });
        }

        if (!Array.isArray(body.permissions)) {
            throw new BadRequestException({
                error: "Permissions must be an array",
            });
        }

        await this.updateRolePermissions(
            accountId,
            role,
            body.permissions,
            userInfo.userId
        );

        return {
            message: "Role permissions updated successfully",
            role,
            permissions: body.permissions,
        };
    }

    async getRolePermissions(
        accountId: number,
        role: string
    ): Promise<string[]> {
        if (!role) {
            return [];
        }

        if (role === "System_Administrator") {
            const rows = await this.db.rolePermission.findMany({
                where: {
                    account_id: accountId,
                    role: role as never,
                },
                select: { permission_key: true },
            });
            const dbKeys = rows.map((r) => r.permission_key);
            if (dbKeys.length === 0) {
                return [...ALL_PERMISSION_KEYS];
            }
            return Array.from(new Set([...dbKeys, ...LOCKED_UAM_KEYS]));
        }

        if (accountId === ADMIN_ACCOUNT_ID && role === "archaser_admin") {
            return [...ALL_PERMISSION_KEYS];
        }

        try {
            const rows = await this.db.rolePermission.findMany({
                where: {
                    account_id: accountId,
                    role: role as never,
                },
                select: { permission_key: true },
            });
            return rows.map((r) => r.permission_key);
        } catch {
            return [];
        }
    }

    async updateRolePermissions(
        accountId: number,
        role: string,
        permissions: string[],
        userId: string
    ): Promise<void> {
        if (!role) {
            throw new BadRequestException({ error: `Invalid role: ${role}` });
        }

        let permissionsToSave = permissions;
        if (role === "System_Administrator") {
            permissionsToSave = Array.from(
                new Set([...permissions, ...LOCKED_UAM_KEYS])
            );
        }

        if (accountId === ADMIN_ACCOUNT_ID && role === "archaser_admin") {
            throw new ForbiddenException({
                error: "Cannot modify permissions for archaser_admin role",
            });
        }

        const allPermissions = this.getAllPermissionKeys();
        const catalog = await this.getFilteredPermissionCatalog(accountId);
        const matrixKeys = new Set(catalog.permissions);

        // Keep grants for keys hidden by product flags (e.g. import_* when
        // has_file_import is off) so turning a flag back on restores them.
        const existingRows = await this.db.rolePermission.findMany({
            where: {
                account_id: accountId,
                role: role as never,
            },
            select: { permission_key: true },
        });
        const preservedHidden = existingRows
            .map((r) => r.permission_key)
            .filter(
                (key) =>
                    !matrixKeys.has(key) && allPermissions.includes(key)
            );

        permissionsToSave = Array.from(
            new Set([...permissionsToSave, ...preservedHidden])
        );

        await this.db.$transaction(async (tx) => {
            await tx.rolePermission.deleteMany({
                where: {
                    account_id: accountId,
                    role: role as never,
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
                            role: role as never,
                            permission_key: permission,
                        },
                    },
                    update: {
                        modified_by: userId,
                        modified_at: new Date(),
                    },
                    create: {
                        account_id: accountId,
                        role: role as never,
                        permission_key: permission,
                        created_by: userId,
                        modified_by: userId,
                    },
                });
            }
        });
    }

    private filterCategoryKeys(
        categories: Record<string, Record<string, string[]>>,
        exclude: Set<string>
    ): Record<string, Record<string, string[]>> {
        const result: Record<string, Record<string, string[]>> = {};
        Object.entries(categories).forEach(([categoryKey, subcategories]) => {
            const nextSubs: Record<string, string[]> = {};
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
}
