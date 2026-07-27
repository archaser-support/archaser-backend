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
exports.EmailController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const database_service_1 = require("../database/database.service");
const TRANSPARENT_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let EmailController = class EmailController {
    constructor(db) {
        this.db = db;
    }
    async trackOpen(messageId, res) {
        if (messageId) {
            const row = await this.db.activityContact.findFirst({
                where: {
                    OR: [
                        { message_id: messageId },
                        { ses_message_id: messageId },
                    ],
                },
            });
            if (row) {
                await this.db.activityContact.update({
                    where: { id: row.id },
                    data: {
                        email_opened_at: row.email_opened_at ?? new Date(),
                        email_open_count: (row.email_open_count ?? 0) + 1,
                        modified_at: new Date(),
                    },
                });
            }
        }
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Content-Length", TRANSPARENT_PNG.length);
        res.send(TRANSPARENT_PNG);
    }
    async trackClick(messageId, url) {
        if (messageId) {
            const row = await this.db.activityContact.findFirst({
                where: {
                    OR: [
                        { message_id: messageId },
                        { ses_message_id: messageId },
                    ],
                },
            });
            if (row) {
                await this.db.activityContact.update({
                    where: { id: row.id },
                    data: {
                        email_clicked_at: row.email_clicked_at ?? new Date(),
                        email_click_count: (row.email_click_count ?? 0) + 1,
                        clicked_link: url ? String(url).slice(0, 500) : null,
                        modified_at: new Date(),
                    },
                });
            }
        }
        const target = url && /^https?:\/\//i.test(url) ? url : process.env.NEXTAUTH_URL || "/";
        return { url: target };
    }
    async sesWebhook(body) {
        let message = body;
        if (typeof body.Message === "string") {
            try {
                message = JSON.parse(body.Message);
            }
            catch {
                message = body;
            }
        }
        if (body.Type === "SubscriptionConfirmation" && body.SubscribeURL) {
            return { success: true, confirmed: true };
        }
        const mail = message.mail;
        const messageId = mail?.messageId ||
            message.mail?.messageId;
        const eventType = String(message.eventType || message.notificationType || "");
        if (messageId) {
            const row = await this.db.activityContact.findFirst({
                where: {
                    OR: [
                        { ses_message_id: messageId },
                        { message_id: messageId },
                    ],
                },
            });
            if (row) {
                const data = {
                    modified_at: new Date(),
                };
                const lower = eventType.toLowerCase();
                if (lower.includes("delivery")) {
                    data.status = "Delivered";
                    data.delivered_at = new Date();
                }
                else if (lower.includes("bounce")) {
                    data.status = "Bounced";
                    data.bounced_at = new Date();
                    const bounce = message.bounce;
                    data.bounce_type = bounce?.bounceType ?? null;
                    data.bounce_sub_type = bounce?.bounceSubType ?? null;
                }
                else if (lower.includes("complaint")) {
                    data.complaint_at = new Date();
                }
                else if (lower.includes("open")) {
                    data.email_opened_at = row.email_opened_at ?? new Date();
                    data.email_open_count = (row.email_open_count ?? 0) + 1;
                }
                else if (lower.includes("click")) {
                    data.email_clicked_at = row.email_clicked_at ?? new Date();
                    data.email_click_count = (row.email_click_count ?? 0) + 1;
                }
                await this.db.activityContact.update({
                    where: { id: row.id },
                    data,
                });
            }
        }
        return { success: true };
    }
};
exports.EmailController = EmailController;
__decorate([
    (0, common_1.Get)("track-open"),
    (0, swagger_1.ApiOperation)({ summary: "Email open tracking pixel (public)" }),
    (0, common_1.Header)("Cache-Control", "no-cache, no-store, must-revalidate"),
    __param(0, (0, common_1.Query)("messageId")),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], EmailController.prototype, "trackOpen", null);
__decorate([
    (0, common_1.Get)("track-click"),
    (0, swagger_1.ApiOperation)({ summary: "Email click tracking redirect (public)" }),
    (0, common_1.Redirect)("/", 302),
    __param(0, (0, common_1.Query)("messageId")),
    __param(1, (0, common_1.Query)("url")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], EmailController.prototype, "trackClick", null);
__decorate([
    (0, common_1.Post)("ses-webhook"),
    (0, swagger_1.ApiOperation)({ summary: "AWS SES event webhook (public)" }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EmailController.prototype, "sesWebhook", null);
exports.EmailController = EmailController = __decorate([
    (0, swagger_1.ApiTags)("email"),
    (0, common_1.Controller)("api/email"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], EmailController);
//# sourceMappingURL=email.controller.js.map