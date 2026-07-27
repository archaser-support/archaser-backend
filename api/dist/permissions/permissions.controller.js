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
exports.PermissionsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const permissions_service_1 = require("./permissions.service");
let PermissionsController = class PermissionsController {
    constructor(permissionsService) {
        this.permissionsService = permissionsService;
    }
    async me(user) {
        return this.permissionsService.getMyPermissions(user);
    }
    async list(user, accountId) {
        return this.permissionsService.getPermissionsMatrix(user, accountId);
    }
    async getRole(user, role, accountId) {
        return this.permissionsService.getPermissionsForRole(user, role, accountId);
    }
    async putRole(user, role, body, accountId) {
        return this.permissionsService.putPermissionsForRole(user, role, body, accountId);
    }
};
exports.PermissionsController = PermissionsController;
__decorate([
    (0, common_1.Get)("me"),
    (0, swagger_1.ApiOperation)({
        summary: "Effective permissions for the authenticated user",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({
        description: "Missing Bearer or session cookie",
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "me", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "Permissions matrix catalog" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)("accountId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":role"),
    (0, swagger_1.ApiOperation)({ summary: "Permissions for a specific role" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("role")),
    __param(2, (0, common_1.Query)("accountId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "getRole", null);
__decorate([
    (0, common_1.Put)(":role"),
    (0, swagger_1.ApiOperation)({ summary: "Update permissions for a specific role" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("role")),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Query)("accountId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object, String]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "putRole", null);
exports.PermissionsController = PermissionsController = __decorate([
    (0, swagger_1.ApiTags)("permissions"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/permissions"),
    __metadata("design:paramtypes", [permissions_service_1.PermissionsService])
], PermissionsController);
//# sourceMappingURL=permissions.controller.js.map