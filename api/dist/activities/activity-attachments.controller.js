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
exports.ActivityAttachmentsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const activities_service_1 = require("./activities.service");
let ActivityAttachmentsController = class ActivityAttachmentsController {
    constructor(activities) {
        this.activities = activities;
    }
    async upload(user, files, req) {
        const activityId = String(req.body?.activityId || "");
        return this.activities.uploadAttachments(user, activityId, files || []);
    }
    async download(user, id, res) {
        const result = await this.activities.getAttachmentDownload(user, id);
        if (result.redirectUrl) {
            return res.redirect(result.redirectUrl);
        }
        return res.json(result.attachment);
    }
    async remove(user, id) {
        return this.activities.deleteAttachment(user, id);
    }
};
exports.ActivityAttachmentsController = ActivityAttachmentsController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiConsumes)("multipart/form-data"),
    (0, swagger_1.ApiOperation)({ summary: "Upload activity attachments (Nest-native)" }),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)("files", 10)),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.UploadedFiles)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Array, Object]),
    __metadata("design:returntype", Promise)
], ActivityAttachmentsController.prototype, "upload", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Download activity attachment (redirect)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], ActivityAttachmentsController.prototype, "download", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Delete activity attachment" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ActivityAttachmentsController.prototype, "remove", null);
exports.ActivityAttachmentsController = ActivityAttachmentsController = __decorate([
    (0, swagger_1.ApiTags)("activity-attachments"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/activity-attachments"),
    __metadata("design:paramtypes", [activities_service_1.ActivitiesService])
], ActivityAttachmentsController);
//# sourceMappingURL=activity-attachments.controller.js.map