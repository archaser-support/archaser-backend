import {
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { AccessScopeService, AccessUserInfo } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";

export class CreditDashboardBuAccessDeniedError extends Error {
    constructor() {
        super("Access denied: business unit not accessible");
        this.name = "CreditDashboardBuAccessDeniedError";
    }
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

export type CreditDashboardAccessMode =
    | "dashboard"
    | "insurance-policy-trend";

@Injectable()
export class CreditDashboardAccessService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    async authorize(
        user: JwtPayload,
        query: Record<string, unknown> = {},
        mode: CreditDashboardAccessMode = "dashboard"
    ): Promise<CreditDashboardAccessContext> {
        let userInfo: AccessUserInfo;
        try {
            userInfo = await this.accessScope.resolveUserInfo(user);
        } catch {
            throw new UnauthorizedException("Unauthorized");
        }

        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);

        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { has_credit_insurance: true },
        });

        if (!account?.has_credit_insurance) {
            throw new ForbiddenException(
                "Credit insurance is not enabled for this account"
            );
        }

        const allowed =
            mode === "insurance-policy-trend"
                ? await this.hasInsurancePolicyTrendAccess(accountId, role)
                : await this.accessScope.hasPermission(
                      accountId,
                      role,
                      "view_credit_dashboard"
                  );

        if (!allowed) {
            throw new ForbiddenException("Forbidden");
        }

        try {
            const { filter, selectedBusinessUnitId } =
                await this.resolveDashboardBusinessUnitFilter({
                    userBusinessUnitId: userInfo.businessUnitId,
                    isAdmin,
                    accountId,
                    selectedBusinessUnitId: this.parseBusinessUnitIdParam(
                        query.businessUnitId
                    ),
                });

            const accessibleBusinessUnitIds =
                await this.getAccessibleBusinessUnitIds(
                    userInfo.businessUnitId ?? null,
                    isAdmin
                );

            return {
                userInfo,
                accountId,
                role,
                isAdmin,
                businessUnitFilter: filter,
                selectedBusinessUnitId,
                accessibleBusinessUnitIds,
            };
        } catch (error) {
            if (error instanceof CreditDashboardBuAccessDeniedError) {
                throw new ForbiddenException(
                    "Access denied: business unit not accessible"
                );
            }
            throw error;
        }
    }

    private async hasInsurancePolicyTrendAccess(
        accountId: number,
        role: string
    ): Promise<boolean> {
        const checks = await Promise.all([
            this.accessScope.hasPermission(accountId, role, "view_settings"),
            this.accessScope.hasPermission(
                accountId,
                role,
                "update_insurance_policy"
            ),
            this.accessScope.hasPermission(
                accountId,
                role,
                "view_credit_dashboard"
            ),
        ]);
        return checks.some(Boolean);
    }

    private parseBusinessUnitIdParam(value: unknown): number | null {
        if (value === undefined || value === null || value === "") {
            return null;
        }
        const raw = Array.isArray(value) ? value[0] : value;
        if (raw === undefined || raw === null || raw === "") {
            return null;
        }
        const parsed = Number.parseInt(String(raw), 10);
        if (Number.isNaN(parsed)) {
            throw new CreditDashboardBuAccessDeniedError();
        }
        return parsed;
    }

    private async resolveDashboardBusinessUnitFilter(input: {
        userBusinessUnitId: number | null | undefined;
        isAdmin: boolean;
        accountId: number;
        selectedBusinessUnitId?: number | null;
    }): Promise<{
        filter: Record<string, unknown>;
        selectedBusinessUnitId: number | null;
    }> {
        const {
            userBusinessUnitId,
            isAdmin,
            accountId,
            selectedBusinessUnitId = null,
        } = input;

        if (selectedBusinessUnitId == null) {
            const filter = await this.accessScope.getBusinessUnitFilter(
                userBusinessUnitId,
                isAdmin,
                accountId
            );
            return { filter, selectedBusinessUnitId: null };
        }

        if (isAdmin) {
            const businessUnit = await this.db.businessUnit.findFirst({
                where: {
                    id: selectedBusinessUnitId,
                    account_id: accountId,
                },
                select: { id: true },
            });
            if (!businessUnit) {
                throw new CreditDashboardBuAccessDeniedError();
            }
            return {
                filter: { business_unit_id: selectedBusinessUnitId },
                selectedBusinessUnitId,
            };
        }

        if (!userBusinessUnitId) {
            throw new CreditDashboardBuAccessDeniedError();
        }

        const descendantIds =
            await this.accessScope.getBusinessUnitHierarchy(userBusinessUnitId);
        const accessibleIds = new Set([userBusinessUnitId, ...descendantIds]);
        if (!accessibleIds.has(selectedBusinessUnitId)) {
            throw new CreditDashboardBuAccessDeniedError();
        }

        return {
            filter: { business_unit_id: selectedBusinessUnitId },
            selectedBusinessUnitId,
        };
    }

    private async getAccessibleBusinessUnitIds(
        userBuId: number | null,
        isAdmin: boolean
    ): Promise<number[] | null> {
        if (isAdmin) {
            return null;
        }
        if (!userBuId) {
            return [];
        }
        const descendants =
            await this.accessScope.getBusinessUnitHierarchy(userBuId);
        return [userBuId, ...descendants];
    }
}
