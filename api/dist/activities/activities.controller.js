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
exports.ActivitiesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const activities_service_1 = require("./activities.service");
let ActivitiesController = class ActivitiesController {
    constructor(activities) {
        this.activities = activities;
    }
    async listSequences(user, query) {
        return this.activities.listSequences(user, query);
    }
    async getSequence(user, id) {
        return this.activities.getSequence(user, id);
    }
    async createSequence(user, body) {
        return this.activities.createSequence(user, body);
    }
    async updateSequence(user, id, body) {
        return this.activities.updateSequence(user, id, body);
    }
    async updateSequenceOp(user, id, operation, body) {
        return this.activities.updateSequence(user, id, body, operation);
    }
    async deleteSequence(user, id) {
        await this.activities.deleteSequence(user, id);
    }
    async listTemplates(user, query) {
        return this.activities.listTemplates(user, query);
    }
    async getTemplate(user, id) {
        return this.activities.getTemplate(user, id);
    }
    async getTemplateOp(user, id, operation) {
        return this.activities.getTemplate(user, id, operation);
    }
    async createTemplate(user, body) {
        return this.activities.createTemplate(user, body);
    }
    async testTemplateEmail(user, id, body) {
        return this.activities.testTemplateEmail(user, id, body);
    }
    async updateTemplate(user, id, body) {
        return this.activities.updateTemplate(user, id, body);
    }
    async updateTemplateOp(user, id, operation, body) {
        return this.activities.updateTemplate(user, id, body, operation);
    }
    async deleteTemplate(user, id) {
        await this.activities.deleteTemplate(user, id);
    }
    async listAttachments(user, activityId) {
        return this.activities.listAttachments(user, activityId);
    }
    async presignedUrl(body) {
        return this.activities.getPresignedUrl(body);
    }
    async deleteAttachment(user, id) {
        return this.activities.deleteAttachment(user, id);
    }
};
exports.ActivitiesController = ActivitiesController;
__decorate([
    (0, common_1.Get)("sequences"),
    (0, swagger_1.ApiOperation)({ summary: "List activity sequences (Nest-native)" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "listSequences", null);
__decorate([
    (0, common_1.Get)("sequences/:id"),
    (0, swagger_1.ApiOperation)({ summary: "Get activity sequence by id" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "getSequence", null);
__decorate([
    (0, common_1.Post)("sequences"),
    (0, common_1.HttpCode)(201),
    (0, swagger_1.ApiOperation)({ summary: "Create activity sequence" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "createSequence", null);
__decorate([
    (0, common_1.Put)("sequences/:id"),
    (0, swagger_1.ApiOperation)({ summary: "Update activity sequence" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "updateSequence", null);
__decorate([
    (0, common_1.Put)("sequences/:id/:operation"),
    (0, swagger_1.ApiOperation)({ summary: "Update activity sequence (operation)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("operation")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, String, Object]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "updateSequenceOp", null);
__decorate([
    (0, common_1.Delete)("sequences/:id"),
    (0, common_1.HttpCode)(204),
    (0, swagger_1.ApiOperation)({ summary: "Delete activity sequence" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "deleteSequence", null);
__decorate([
    (0, common_1.Get)("templates"),
    (0, swagger_1.ApiOperation)({ summary: "List activity templates" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "listTemplates", null);
__decorate([
    (0, common_1.Get)("templates/:id"),
    (0, swagger_1.ApiOperation)({ summary: "Get activity template by id" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "getTemplate", null);
__decorate([
    (0, common_1.Get)("templates/:id/:operation"),
    (0, swagger_1.ApiOperation)({ summary: "Template operation (e.g. check-usage)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("operation")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, String]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "getTemplateOp", null);
__decorate([
    (0, common_1.Post)("templates"),
    (0, common_1.HttpCode)(201),
    (0, swagger_1.ApiOperation)({ summary: "Create activity template" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "createTemplate", null);
__decorate([
    (0, common_1.Post)("templates/:id/test-email"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: "Send activity template test email to caller" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "testTemplateEmail", null);
__decorate([
    (0, common_1.Put)("templates/:id"),
    (0, swagger_1.ApiOperation)({ summary: "Update activity template" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "updateTemplate", null);
__decorate([
    (0, common_1.Put)("templates/:id/:operation"),
    (0, swagger_1.ApiOperation)({ summary: "Update activity template (operation)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)("operation")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, String, Object]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "updateTemplateOp", null);
__decorate([
    (0, common_1.Delete)("templates/:id"),
    (0, common_1.HttpCode)(204),
    (0, swagger_1.ApiOperation)({ summary: "Delete activity template" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "deleteTemplate", null);
__decorate([
    (0, common_1.Get)("attachments"),
    (0, swagger_1.ApiOperation)({ summary: "List activity attachments" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)("activityId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "listAttachments", null);
__decorate([
    (0, common_1.Post)("attachments/presigned-url"),
    (0, swagger_1.ApiOperation)({ summary: "Generate attachment download URL (S3 or stub)" }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "presignedUrl", null);
__decorate([
    (0, common_1.Delete)("attachments/:id"),
    (0, swagger_1.ApiOperation)({ summary: "Delete activity attachment" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ActivitiesController.prototype, "deleteAttachment", null);
exports.ActivitiesController = ActivitiesController = __decorate([
    (0, swagger_1.ApiTags)("activities"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/activities"),
    __metadata("design:paramtypes", [activities_service_1.ActivitiesService])
], ActivitiesController);
//# sourceMappingURL=activities.controller.js.map