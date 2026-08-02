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
exports.AccountsExtrasController = exports.UsersExtrasController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let UsersExtrasController = class UsersExtrasController {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async systemAdministratorCheck(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const isSystemAdmin = this.accessScope.isAdminAccount(userInfo.accountId) ||
            userInfo.role === "System_Administrator" ||
            userInfo.role === "System Administrator";
        return { isSystemAdministrator: isSystemAdmin };
    }
    async setViewAs(user, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const hasViewAs = await this.accessScope.hasPermission(accountId, userInfo.role, "use_view_as");
        if (!hasViewAs &&
            !this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new common_1.ForbiddenException({
                error: "Missing use_view_as permission",
            });
        }
        if (!body.userId) {
            throw new common_1.BadRequestException({ error: "userId is required" });
        }
        const target = await this.db.user.findUnique({
            where: { id: body.userId },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                account_id: true,
            },
        });
        if (!target) {
            throw new common_1.NotFoundException({ error: "User not found" });
        }
        return (0, serialize_bigint_1.serializeBigInt)({
            success: true,
            viewAsUser: target,
        });
    }
    async clearViewAs(_user) {
        return { success: true };
    }
    async changePassword(user, id, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const password = body.password || body.newPassword;
        if (!password || String(password).length < 8) {
            throw new common_1.BadRequestException({
                error: "password must be at least 8 characters",
            });
        }
        const target = await this.db.user.findUnique({
            where: { id },
            select: { id: true, account_id: true },
        });
        if (!target) {
            throw new common_1.NotFoundException({ error: "User not found" });
        }
        const isSelf = userInfo.userId === id;
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        if (!isSelf && !isAdmin && target.account_id !== userInfo.accountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        return {
            success: true,
            message: "Password change acknowledged",
            userId: id,
        };
    }
};
exports.UsersExtrasController = UsersExtrasController;
__decorate([
    (0, common_1.Get)("system-administrator-check"),
    (0, swagger_1.ApiOperation)({ summary: "Whether the caller is a system administrator" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersExtrasController.prototype, "systemAdministratorCheck", null);
__decorate([
    (0, common_1.Post)("view-as"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: "Start view-as for another user" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersExtrasController.prototype, "setViewAs", null);
__decorate([
    (0, common_1.Delete)("view-as"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: "Clear view-as" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersExtrasController.prototype, "clearViewAs", null);
__decorate([
    (0, common_1.Post)(":id/change-password"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: "Change a user's password (admin)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], UsersExtrasController.prototype, "changePassword", null);
exports.UsersExtrasController = UsersExtrasController = __decorate([
    (0, swagger_1.ApiTags)("entities"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/entities/users"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], UsersExtrasController);
let AccountsExtrasController = class AccountsExtrasController {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async gdprReport(user, id) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId) &&
            userInfo.accountId !== id) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        const account = await this.db.account.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                deleted_at: true,
                status: true,
            },
        });
        if (!account) {
            throw new common_1.NotFoundException({ error: "Account not found" });
        }
        return (0, serialize_bigint_1.serializeBigInt)({
            account,
            generatedAt: new Date().toISOString(),
            canRestore: !!account.deleted_at,
        });
    }
    async restore(user, id) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new common_1.ForbiddenException({
                error: "Access denied: Only Archaser Admin can restore accounts",
            });
        }
        const account = await this.db.account.findUnique({
            where: { id },
            select: { id: true, deleted_at: true },
        });
        if (!account) {
            throw new common_1.NotFoundException({ error: "Account not found" });
        }
        const restored = await this.db.account.update({
            where: { id },
            data: { deleted_at: null, status: "Active" },
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            success: true,
            restoredAt: new Date().toISOString(),
            account: restored,
        });
    }
};
exports.AccountsExtrasController = AccountsExtrasController;
__decorate([
    (0, common_1.Get)(":id/gdpr-report"),
    (0, swagger_1.ApiOperation)({ summary: "Account GDPR export report metadata" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], AccountsExtrasController.prototype, "gdprReport", null);
__decorate([
    (0, common_1.Post)(":id/restore"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: "Restore a soft-deleted account" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], AccountsExtrasController.prototype, "restore", null);
exports.AccountsExtrasController = AccountsExtrasController = __decorate([
    (0, swagger_1.ApiTags)("entities"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/entities/accounts"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], AccountsExtrasController);
//# sourceMappingURL=users-accounts-extras.controller.js.map