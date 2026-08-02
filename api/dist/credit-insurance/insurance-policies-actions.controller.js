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
exports.InsurancePoliciesActionsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const insurance_entities_service_1 = require("./insurance-entities.service");
let InsurancePoliciesActionsController = class InsurancePoliciesActionsController {
    constructor(insurance) {
        this.insurance = insurance;
    }
    async bulkReplace(user, body) {
        return this.insurance.bulkReplacePolicy(user, body);
    }
    async customerPrefill(user, id, query) {
        return this.insurance.customerPrefill(user, id, query);
    }
};
exports.InsurancePoliciesActionsController = InsurancePoliciesActionsController;
__decorate([
    (0, common_1.Post)("bulk-replace"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: "Reassign customers from one policy to another" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], InsurancePoliciesActionsController.prototype, "bulkReplace", null);
__decorate([
    (0, common_1.Get)(":id/customer-prefill"),
    (0, swagger_1.ApiOperation)({
        summary: "Prefill customer insurance fields from policy / named / country",
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], InsurancePoliciesActionsController.prototype, "customerPrefill", null);
exports.InsurancePoliciesActionsController = InsurancePoliciesActionsController = __decorate([
    (0, swagger_1.ApiTags)("entities"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/entities/insurance-policies"),
    __metadata("design:paramtypes", [insurance_entities_service_1.InsuranceEntitiesService])
], InsurancePoliciesActionsController);
//# sourceMappingURL=insurance-policies-actions.controller.js.map