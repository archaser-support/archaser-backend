import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
import { PermissionsService } from "../permissions/permissions.service";

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
] as const;

@Injectable()
export class RolesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService,
        private readonly permissions: PermissionsService
    ) {}

    private resolveTargetAccountId(
        userInfo: Awaited<ReturnType<AccessScopeService["resolveUserInfo"]>>,
        requestedAccountId: number | null
    ): number {
        if (
            requestedAccountId &&
            this.accessScope.isAdminAccount(userInfo.accountId)
        ) {
            return requestedAccountId;
        }
        return this.accessScope.getEffectiveAccountId(userInfo);
    }

    async listRoles(user: JwtPayload, accountIdQuery?: string) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId = accountIdQuery
            ? parseInt(accountIdQuery, 10)
            : null;
        const accountId = this.resolveTargetAccountId(
            userInfo,
            Number.isFinite(requestedAccountId) ? requestedAccountId : null
        );

        const baseRoles = ALL_ROLES.filter((r) => r !== "archaser_admin");
        let rolesToProcess: string[] =
            accountId === 10013 ? [...ALL_ROLES] : [...baseRoles];

        if (accountId !== 10013) {
            const account = await this.db.account.findUnique({
                where: { id: accountId },
                select: {
                    has_collection: true,
                    has_credit_insurance: true,
                } as never,
            });

            const hasCollection =
                (account as { has_collection?: boolean } | null)
                    ?.has_collection !== undefined
                    ? Boolean(
                          (account as { has_collection?: boolean })
                              .has_collection
                      )
                    : true;
            const hasCreditInsurance = Boolean(
                (account as { has_credit_insurance?: boolean } | null)
                    ?.has_credit_insurance
            );

            const masterRolePermissions =
                await this.db.rolePermission.findMany({
                    where: { account_id: 10013 },
                    select: {
                        role: true,
                        is_collection: true,
                        is_credit_insurance: true,
                    },
                    distinct: ["role"],
                });

            const eligibleRoles = new Set<string>();
            for (const row of masterRolePermissions) {
                const collectionEnabled = row.is_collection !== false;
                const creditEnabled = row.is_credit_insurance === true;
                if (
                    (hasCollection && collectionEnabled) ||
                    (hasCreditInsurance && creditEnabled)
                ) {
                    eligibleRoles.add(row.role);
                }
            }
            const filteredByProduct = baseRoles.filter((role) =>
                eligibleRoles.has(role)
            );
            // Credit-only (or otherwise mismatched) accounts can end up with an
            // empty set when master RolePermission rows are collection-flagged
            // only. Fall back to the full base role list so user creation still
            // has selectable roles.
            rolesToProcess =
                filteredByProduct.length > 0
                    ? filteredByProduct
                    : [...baseRoles];
        }

        const rolesWithCounts = await Promise.all(
            rolesToProcess.map(async (role) => {
                const permissions =
                    await this.permissions.getRolePermissions(accountId, role);
                return { role, permissionCount: permissions.length };
            })
        );

        const filteredRoles = rolesWithCounts.filter(
            (r) => r.role !== "archaser_admin" || accountId === 10013
        );

        return { roles: filteredRoles };
    }

    async getRole(
        user: JwtPayload,
        role: string,
        accountIdQuery?: string
    ) {
        if (!role) {
            throw new BadRequestException({ error: "Role is required" });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const requestedAccountId = accountIdQuery
            ? parseInt(accountIdQuery, 10)
            : null;
        const accountId = this.resolveTargetAccountId(
            userInfo,
            Number.isFinite(requestedAccountId) ? requestedAccountId : null
        );

        const permissions = await this.permissions.getRolePermissions(
            accountId,
            role
        );
        return {
            role,
            permissions,
            permissionCount: permissions.length,
        };
    }

    async updateRole(
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

        let accountId = this.accessScope.getEffectiveAccountId(userInfo);
        if (
            requestedAccountId &&
            this.accessScope.isAdminAccount(userInfo.accountId)
        ) {
            accountId = requestedAccountId;
        }

        const isSystemAdmin = this.accessScope.isAdminAccount(
            userInfo.accountId
        );
        const userPermissions = await this.permissions.getRolePermissions(
            userInfo.accountId,
            userInfo.role
        );
        const hasManage = userPermissions.includes("manage_security_role");

        if (!isSystemAdmin && !hasManage) {
            throw new ForbiddenException({
                error: "You do not have permission to manage role permissions",
            });
        }
        if (!isSystemAdmin && accountId !== userInfo.accountId) {
            throw new ForbiddenException({
                error: "You can only edit role permissions for your own account",
            });
        }
        if (accountId === 10013 && role === "archaser_admin") {
            throw new ForbiddenException({
                error: "Cannot modify permissions for archaser_admin role on system account",
            });
        }

        const { permissions } = body;
        if (!Array.isArray(permissions)) {
            throw new BadRequestException({
                error: "Permissions must be an array",
            });
        }

        await this.permissions.updateRolePermissions(
            accountId,
            role,
            permissions,
            userInfo.userId
        );

        return {
            message: "Role permissions updated successfully",
            role,
            permissions,
        };
    }
}
