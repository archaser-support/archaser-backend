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
exports.UploadController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const crypto_1 = require("crypto");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
let UploadController = class UploadController {
    async s3(user, body) {
        const accountId = typeof body.accountId === "number"
            ? body.accountId
            : user.account_id;
        const activityId = typeof body.activityId === "string"
            ? body.activityId
            : "logo";
        const fileName = typeof body.fileName === "string"
            ? body.fileName
            : typeof body.filename === "string"
                ? body.filename
                : `upload-${(0, crypto_1.randomUUID)()}`;
        const contentType = typeof body.contentType === "string"
            ? body.contentType
            : "application/octet-stream";
        const bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET;
        const region = process.env.AWS_REGION || "us-east-1";
        const accessKey = process.env.AWS_ACCESS_KEY_ID;
        const key = `accounts/${accountId}/${activityId}/${Date.now()}-${fileName}`;
        if (bucket && accessKey) {
            const hash = (0, crypto_1.createHash)("sha256")
                .update(`${key}:${user.sub}:${Date.now()}`)
                .digest("hex")
                .slice(0, 16);
            return {
                success: true,
                bucket,
                region,
                key,
                contentType,
                uploadUrl: `https://${bucket}.s3.${region}.amazonaws.com/${key}?X-Amz-Stub=${hash}`,
                publicUrl: `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
                stub: true,
            };
        }
        return {
            success: true,
            key,
            contentType,
            uploadUrl: `/api/upload/local-stub/${encodeURIComponent(key)}`,
            publicUrl: `/uploads/${encodeURIComponent(key)}`,
            stub: true,
            message: "AWS_* not configured — returning Nest-native local stub URLs",
        };
    }
};
exports.UploadController = UploadController;
__decorate([
    (0, common_1.Post)("s3"),
    (0, swagger_1.ApiOperation)({ summary: "S3 upload / presign stub (Nest-native)" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "s3", null);
exports.UploadController = UploadController = __decorate([
    (0, swagger_1.ApiTags)("upload"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/upload")
], UploadController);
//# sourceMappingURL=upload.controller.js.map