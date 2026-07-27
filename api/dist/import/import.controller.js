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
exports.ImportDomainController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const import_service_1 = require("./import.service");
let ImportDomainController = class ImportDomainController {
    constructor(importService) {
        this.importService = importService;
    }
    async payment(user, body) {
        return this.importService.importLeaf("payment", user, body);
    }
    async customer(user, body) {
        return this.importService.importLeaf("customer", user, body);
    }
    async contact(user, body) {
        return this.importService.importLeaf("contact", user, body);
    }
    async invoice(user, body) {
        return this.importService.importLeaf("invoice", user, body);
    }
    async policy(user, body) {
        return this.importService.importLeaf("policy", user, body);
    }
    async jobCreate(user, body) {
        return this.importService.createJob(user, body);
    }
    async jobComplete(user, body) {
        return this.importService.completeJob(user, body);
    }
    async jobById(jobId, user) {
        return this.importService.getJobById(user, jobId);
    }
};
exports.ImportDomainController = ImportDomainController;
__decorate([
    (0, common_1.Post)("payment"),
    (0, swagger_1.ApiOperation)({ summary: "Payment import (Nest-native)" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing auth" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ImportDomainController.prototype, "payment", null);
__decorate([
    (0, common_1.Post)("customer"),
    (0, swagger_1.ApiOperation)({ summary: "Customer import (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ImportDomainController.prototype, "customer", null);
__decorate([
    (0, common_1.Post)("contact"),
    (0, swagger_1.ApiOperation)({ summary: "Contact import (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ImportDomainController.prototype, "contact", null);
__decorate([
    (0, common_1.Post)("invoice"),
    (0, swagger_1.ApiOperation)({ summary: "Invoice import (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ImportDomainController.prototype, "invoice", null);
__decorate([
    (0, common_1.Post)("policy"),
    (0, swagger_1.ApiOperation)({ summary: "Policy import (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ImportDomainController.prototype, "policy", null);
__decorate([
    (0, common_1.Post)("job/create"),
    (0, swagger_1.ApiOperation)({ summary: "Create import job (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ImportDomainController.prototype, "jobCreate", null);
__decorate([
    (0, common_1.Post)("job/complete"),
    (0, swagger_1.ApiOperation)({ summary: "Complete import job (Nest-native)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ImportDomainController.prototype, "jobComplete", null);
__decorate([
    (0, common_1.Get)("job/:jobId"),
    (0, swagger_1.ApiParam)({ name: "jobId", description: "Import job id" }),
    (0, swagger_1.ApiOperation)({ summary: "Import job status / detail by id (Nest-native)" }),
    __param(0, (0, common_1.Param)("jobId")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ImportDomainController.prototype, "jobById", null);
exports.ImportDomainController = ImportDomainController = __decorate([
    (0, swagger_1.ApiTags)("import"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/import"),
    __metadata("design:paramtypes", [import_service_1.ImportService])
], ImportDomainController);
//# sourceMappingURL=import.controller.js.map