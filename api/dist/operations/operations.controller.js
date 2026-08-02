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
exports.OperationsDomainController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const route_catalog_constants_1 = require("../domain/route-catalog.constants");
const operations_service_1 = require("./operations.service");
let OperationsDomainController = class OperationsDomainController {
    constructor(operations) {
        this.operations = operations;
    }
    async list(operationType, user, query) {
        return this.operations.list(operationType, user, query);
    }
    async deleteNotification(id, user) {
        return this.operations.deleteNotification(user, id);
    }
    async deleteNotificationsBulk(user, body) {
        return this.operations.deleteNotificationsBulk(user, body);
    }
    async updateNotification(id, user, body) {
        return this.operations.updateNotification(user, id, body);
    }
    async disputeStats(user) {
        return this.operations.getDisputeStats(user);
    }
    async legalCasesStats(user) {
        return this.operations.getLegalCasesStats(user);
    }
    async byId(operationType, id, user) {
        return this.operations.getById(operationType, user, id);
    }
    async update(operationType, id, user, body) {
        return this.operations.update(operationType, user, id, body);
    }
    async create(operationType, user, body) {
        void user;
        void body;
        return { ok: true, operationType };
    }
};
exports.OperationsDomainController = OperationsDomainController;
__decorate([
    (0, common_1.Get)(":operationType"),
    (0, swagger_1.ApiParam)({
        name: "operationType",
        enum: route_catalog_constants_1.OPERATION_TYPES,
    }),
    (0, swagger_1.ApiOperation)({
        summary: "Operations list (Nest-native)",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, common_1.Param)("operationType")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], OperationsDomainController.prototype, "list", null);
__decorate([
    (0, common_1.Delete)("notifications/:id"),
    (0, swagger_1.ApiOperation)({ summary: "Delete a notification" }),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], OperationsDomainController.prototype, "deleteNotification", null);
__decorate([
    (0, common_1.Delete)("notifications"),
    (0, swagger_1.ApiOperation)({ summary: "Bulk notification delete / cleanup" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OperationsDomainController.prototype, "deleteNotificationsBulk", null);
__decorate([
    (0, common_1.Put)("notifications/:id"),
    (0, swagger_1.ApiOperation)({ summary: "Mark notification read / update" }),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], OperationsDomainController.prototype, "updateNotification", null);
__decorate([
    (0, common_1.Get)("disputes/stats"),
    (0, swagger_1.ApiOperation)({ summary: "Dispute statistics" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OperationsDomainController.prototype, "disputeStats", null);
__decorate([
    (0, common_1.Get)("legal-cases/stats"),
    (0, swagger_1.ApiOperation)({ summary: "Legal cases statistics" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OperationsDomainController.prototype, "legalCasesStats", null);
__decorate([
    (0, common_1.Get)(":operationType/:id"),
    (0, swagger_1.ApiParam)({ name: "operationType", enum: route_catalog_constants_1.OPERATION_TYPES }),
    (0, swagger_1.ApiOperation)({ summary: "Operations detail by id (Nest-native)" }),
    __param(0, (0, common_1.Param)("operationType")),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], OperationsDomainController.prototype, "byId", null);
__decorate([
    (0, common_1.Put)(":operationType/:id"),
    (0, swagger_1.ApiParam)({ name: "operationType", enum: route_catalog_constants_1.OPERATION_TYPES }),
    (0, swagger_1.ApiOperation)({ summary: "Operations update (Nest-native)" }),
    __param(0, (0, common_1.Param)("operationType")),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], OperationsDomainController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(":operationType"),
    (0, swagger_1.ApiParam)({ name: "operationType", enum: route_catalog_constants_1.OPERATION_TYPES }),
    (0, swagger_1.ApiOperation)({ summary: "Operations create (Nest-native stub)" }),
    __param(0, (0, common_1.Param)("operationType")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], OperationsDomainController.prototype, "create", null);
exports.OperationsDomainController = OperationsDomainController = __decorate([
    (0, swagger_1.ApiTags)("operations"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/operations"),
    __metadata("design:paramtypes", [operations_service_1.OperationsService])
], OperationsDomainController);
//# sourceMappingURL=operations.controller.js.map