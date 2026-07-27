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
exports.CreditDashboardAccessService = exports.CreditDashboardBuAccessDeniedError = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const database_service_1 = require("../database/database.service");
class CreditDashboardBuAccessDeniedError extends Error {
    constructor() {
        super("Access denied: business unit not accessible");
        this.name = "CreditDashboardBuAccessDeniedError";
    }
}
exports.CreditDashboardBuAccessDeniedError = CreditDashboardBuAccessDeniedError;
let CreditDashboardAccessService = class CreditDashboardAccessService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async authorize(user, query = {}, mode = "dashboard") {
        let userInfo;
        try {
            userInfo = await this.accessScope.resolveUserInfo(user);
        }
        catch {
            throw new common_1.UnauthorizedException("Unauthorized");
        }
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { has_credit_insurance: true },
        });
        if (!account?.has_credit_insurance) {
            throw new common_1.ForbiddenException("Credit insurance is not enabled for this account");
        }
        const allowed = mode === "insurance-policy-trend"
            ? await this.hasInsurancePolicyTrendAccess(accountId, role)
            : await this.accessScope.hasPermission(accountId, role, "view_credit_dashboard");
        if (!allowed) {
            throw new common_1.ForbiddenException("Forbidden");
        }
        try {
            const { filter, selectedBusinessUnitId } = await this.resolveDashboardBusinessUnitFilter({
                userBusinessUnitId: userInfo.businessUnitId,
                isAdmin,
                accountId,
                selectedBusinessUnitId: this.parseBusinessUnitIdParam(query.businessUnitId),
            });
            const accessibleBusinessUnitIds = await this.getAccessibleBusinessUnitIds(userInfo.businessUnitId ?? null, isAdmin);
            return {
                userInfo,
                accountId,
                role,
                isAdmin,
                businessUnitFilter: filter,
                selectedBusinessUnitId,
                accessibleBusinessUnitIds,
            };
        }
        catch (error) {
            if (error instanceof CreditDashboardBuAccessDeniedError) {
                throw new common_1.ForbiddenException("Access denied: business unit not accessible");
            }
            throw error;
        }
    }
    async hasInsurancePolicyTrendAccess(accountId, role) {
        const checks = await Promise.all([
            this.accessScope.hasPermission(accountId, role, "view_settings"),
            this.accessScope.hasPermission(accountId, role, "update_insurance_policy"),
            this.accessScope.hasPermission(accountId, role, "view_credit_dashboard"),
        ]);
        return checks.some(Boolean);
    }
    parseBusinessUnitIdParam(value) {
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
    async resolveDashboardBusinessUnitFilter(input) {
        const { userBusinessUnitId, isAdmin, accountId, selectedBusinessUnitId = null, } = input;
        if (selectedBusinessUnitId == null) {
            const filter = await this.accessScope.getBusinessUnitFilter(userBusinessUnitId, isAdmin, accountId);
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
        const descendantIds = await this.accessScope.getBusinessUnitHierarchy(userBusinessUnitId);
        const accessibleIds = new Set([userBusinessUnitId, ...descendantIds]);
        if (!accessibleIds.has(selectedBusinessUnitId)) {
            throw new CreditDashboardBuAccessDeniedError();
        }
        return {
            filter: { business_unit_id: selectedBusinessUnitId },
            selectedBusinessUnitId,
        };
    }
    async getAccessibleBusinessUnitIds(userBuId, isAdmin) {
        if (isAdmin) {
            return null;
        }
        if (!userBuId) {
            return [];
        }
        const descendants = await this.accessScope.getBusinessUnitHierarchy(userBuId);
        return [userBuId, ...descendants];
    }
};
exports.CreditDashboardAccessService = CreditDashboardAccessService;
exports.CreditDashboardAccessService = CreditDashboardAccessService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], CreditDashboardAccessService);
//# sourceMappingURL=credit-dashboard-access.service.js.map