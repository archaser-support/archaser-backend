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
exports.BusinessUnitsService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const database_service_1 = require("../database/database.service");
let BusinessUnitsService = class BusinessUnitsService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    isElevatedRole(role, accountId) {
        return (this.accessScope.isAdminAccount(accountId) ||
            role === "archaser_admin" ||
            role === "ARchaser Admin" ||
            role === "Admin" ||
            role === "System_Administrator" ||
            role === "System Administrator");
    }
    async validateAccess(user, externalIds) {
        if (!Array.isArray(externalIds)) {
            throw new common_1.BadRequestException({
                error: "externalIds must be an array",
            });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const hasViewBu = await this.accessScope.hasPermission(accountId, role, "view_business_units");
        const isAdmin = this.isElevatedRole(role, userInfo.accountId);
        if (!isAdmin && !hasViewBu) {
            throw new common_1.ForbiddenException({
                error: "Access denied",
                message: "You do not have permission to view business units",
            });
        }
        const userBuId = userInfo.businessUnitId ?? null;
        const results = [];
        for (const raw of externalIds) {
            if (!raw || typeof raw !== "string")
                continue;
            const externalId = raw.trim();
            if (!externalId)
                continue;
            const businessUnit = await this.db.businessUnit.findFirst({
                where: { external_id: externalId, account_id: accountId },
                select: { id: true },
            });
            const exists = !!businessUnit;
            let hasAccess = true;
            if (exists && businessUnit) {
                hasAccess = await this.canAccessBu(businessUnit.id, userBuId, isAdmin);
            }
            results.push({ externalId, hasAccess, exists });
        }
        return { items: results };
    }
    async canAccessBu(targetBuId, userBuId, isAdmin) {
        if (isAdmin)
            return true;
        if (userBuId == null)
            return false;
        if (userBuId === targetBuId)
            return true;
        const descendants = await this.accessScope.getBusinessUnitHierarchy(userBuId);
        return descendants.includes(targetBuId);
    }
    async getAccessibleBusinessUnitIds(userBuId, isAdmin) {
        if (isAdmin)
            return null;
        if (userBuId == null)
            return [];
        const descendants = await this.accessScope.getBusinessUnitHierarchy(userBuId);
        return [userBuId, ...descendants];
    }
};
exports.BusinessUnitsService = BusinessUnitsService;
exports.BusinessUnitsService = BusinessUnitsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], BusinessUnitsService);
//# sourceMappingURL=business-units.service.js.map