import {
    BadRequestException,
    ForbiddenException,
    Injectable,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";

@Injectable()
export class BusinessUnitsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    private isElevatedRole(role: string, accountId: number): boolean {
        return (
            this.accessScope.isAdminAccount(accountId) ||
            role === "archaser_admin" ||
            role === "ARchaser Admin" ||
            role === "Admin" ||
            role === "System_Administrator" ||
            role === "System Administrator"
        );
    }

    async validateAccess(user: JwtPayload, externalIds: string[]) {
        if (!Array.isArray(externalIds)) {
            throw new BadRequestException({
                error: "externalIds must be an array",
            });
        }

        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;

        const hasViewBu = await this.accessScope.hasPermission(
            accountId,
            role,
            "view_business_units"
        );
        const isAdmin = this.isElevatedRole(role, userInfo.accountId);
        if (!isAdmin && !hasViewBu) {
            throw new ForbiddenException({
                error: "Access denied",
                message: "You do not have permission to view business units",
            });
        }

        const userBuId = userInfo.businessUnitId ?? null;
        const results: Array<{
            externalId: string;
            hasAccess: boolean;
            exists: boolean;
        }> = [];

        for (const raw of externalIds) {
            if (!raw || typeof raw !== "string") continue;
            const externalId = raw.trim();
            if (!externalId) continue;

            const businessUnit = await this.db.businessUnit.findFirst({
                where: { external_id: externalId, account_id: accountId },
                select: { id: true },
            });
            const exists = !!businessUnit;
            let hasAccess = true;
            if (exists && businessUnit) {
                hasAccess = await this.canAccessBu(
                    businessUnit.id,
                    userBuId,
                    isAdmin
                );
            }
            results.push({ externalId, hasAccess, exists });
        }

        return { items: results };
    }

    private async canAccessBu(
        targetBuId: number,
        userBuId: number | null,
        isAdmin: boolean
    ): Promise<boolean> {
        if (isAdmin) return true;
        if (userBuId == null) return false;
        if (userBuId === targetBuId) return true;
        const descendants =
            await this.accessScope.getBusinessUnitHierarchy(userBuId);
        return descendants.includes(targetBuId);
    }

    async getAccessibleBusinessUnitIds(
        userBuId: number | null,
        isAdmin: boolean
    ): Promise<number[] | null> {
        if (isAdmin) return null;
        if (userBuId == null) return [];
        const descendants =
            await this.accessScope.getBusinessUnitHierarchy(userBuId);
        return [userBuId, ...descendants];
    }
}
