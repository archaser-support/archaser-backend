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
exports.AccountsBusinessUnitsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const account_admin_entities_service_1 = require("./account-admin-entities.service");
let AccountsBusinessUnitsController = class AccountsBusinessUnitsController {
    constructor(service) {
        this.service = service;
    }
    async list(user, accountId, query) {
        return this.service.listAccountBusinessUnits(user, accountId, query);
    }
};
exports.AccountsBusinessUnitsController = AccountsBusinessUnitsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({
        summary: "List business units for an account (Nest-native)",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({
        description: "Missing Bearer or session cookie",
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("accountId", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], AccountsBusinessUnitsController.prototype, "list", null);
exports.AccountsBusinessUnitsController = AccountsBusinessUnitsController = __decorate([
    (0, swagger_1.ApiTags)("entities"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/entities/accounts/:accountId/business-units"),
    __metadata("design:paramtypes", [account_admin_entities_service_1.AccountAdminEntitiesService])
], AccountsBusinessUnitsController);
//# sourceMappingURL=accounts-business-units.controller.js.map