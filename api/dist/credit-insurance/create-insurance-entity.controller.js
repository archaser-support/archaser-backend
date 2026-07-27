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
exports.createInsuranceEntityController = createInsuranceEntityController;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const insurance_entities_service_1 = require("./insurance-entities.service");
function createInsuranceEntityController(entityType) {
    let InsuranceEntityController = class InsuranceEntityController {
        constructor(service) {
            this.service = service;
        }
        async list(user, query) {
            return this.service.list(entityType, user, query);
        }
        async byId(user, id) {
            return this.service.getById(entityType, user, this.service.parseId(entityType, id));
        }
        async update(user, id, body) {
            return this.service.update(entityType, user, this.service.parseId(entityType, id), body);
        }
    };
    __decorate([
        (0, common_1.Get)(),
        (0, swagger_1.ApiOperation)({ summary: `${entityType} list (Nest-native)` }),
        (0, swagger_1.ApiUnauthorizedResponse)({
            description: "Missing Bearer or session cookie",
        }),
        __param(0, (0, current_user_decorator_1.CurrentUser)()),
        __param(1, (0, common_1.Query)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, Object]),
        __metadata("design:returntype", Promise)
    ], InsuranceEntityController.prototype, "list", null);
    __decorate([
        (0, common_1.Get)(":id"),
        (0, swagger_1.ApiOperation)({ summary: `${entityType} detail (Nest-native)` }),
        __param(0, (0, current_user_decorator_1.CurrentUser)()),
        __param(1, (0, common_1.Param)("id")),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, String]),
        __metadata("design:returntype", Promise)
    ], InsuranceEntityController.prototype, "byId", null);
    __decorate([
        (0, common_1.Put)(":id"),
        (0, swagger_1.ApiOperation)({ summary: `${entityType} update (Nest-native)` }),
        __param(0, (0, current_user_decorator_1.CurrentUser)()),
        __param(1, (0, common_1.Param)("id")),
        __param(2, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, String, Object]),
        __metadata("design:returntype", Promise)
    ], InsuranceEntityController.prototype, "update", null);
    InsuranceEntityController = __decorate([
        (0, swagger_1.ApiTags)("entities"),
        (0, swagger_1.ApiBearerAuth)(),
        (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
        (0, common_1.Controller)(`api/entities/${entityType}`),
        __metadata("design:paramtypes", [insurance_entities_service_1.InsuranceEntitiesService])
    ], InsuranceEntityController);
    Object.defineProperty(InsuranceEntityController, "name", {
        value: `${entityType.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase())}InsuranceEntityController`,
    });
    return InsuranceEntityController;
}
//# sourceMappingURL=create-insurance-entity.controller.js.map