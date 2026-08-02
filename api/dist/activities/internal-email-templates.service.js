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
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalEmailTemplatesService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const system_email_service_1 = require("../email/system-email.service");
let InternalEmailTemplatesService = class InternalEmailTemplatesService {
    constructor(db, accessScope, systemEmail) {
        this.db = db;
        this.accessScope = accessScope;
        this.systemEmail = systemEmail;
    }
    async accountId(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveAccountId(userInfo);
    }
    async list(user) {
        const accountId = await this.accountId(user);
        const templates = await this.db.internalEmailTemplate.findMany({
            where: { account_id: accountId },
            orderBy: { type: "asc" },
        });
        return (0, serialize_bigint_1.serializeBigInt)(templates || []);
    }
    async listMaster(type) {
        if (type) {
            const template = await this.db.internalEmailTemplate.findFirst({
                where: {
                    type: type,
                    master_template: true,
                    active: true,
                },
            });
            if (!template) {
                throw new common_1.NotFoundException({
                    error: "Master template not found",
                });
            }
            return (0, serialize_bigint_1.serializeBigInt)(template);
        }
        const templates = await this.db.internalEmailTemplate.findMany({
            where: { master_template: true, active: true },
            orderBy: { type: "asc" },
        });
        return (0, serialize_bigint_1.serializeBigInt)(templates);
    }
    async getById(user, id) {
        const accountId = await this.accountId(user);
        const template = await this.db.internalEmailTemplate.findFirst({
            where: { id, account_id: accountId },
        });
        if (!template) {
            throw new common_1.NotFoundException({ error: "Template not found" });
        }
        return (0, serialize_bigint_1.serializeBigInt)(template);
    }
    async create(user, body) {
        const accountId = await this.accountId(user);
        const { name, type, subject, content } = body;
        if (!name || !type || !subject || !content) {
            throw new common_1.BadRequestException({
                error: "Missing required fields",
            });
        }
        const template = await this.db.internalEmailTemplate.create({
            data: {
                name: String(name),
                type: type,
                subject: String(subject),
                content: String(content),
                account_id: accountId,
                master_template: false,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(template);
    }
    async update(user, id, body) {
        const accountId = await this.accountId(user);
        const existing = await this.db.internalEmailTemplate.findFirst({
            where: { id, account_id: accountId },
        });
        if (!existing) {
            throw new common_1.NotFoundException({ error: "Template not found" });
        }
        const { name, subject, content, active } = body;
        const data = {};
        if (name)
            data.name = String(name);
        if (subject)
            data.subject = String(subject);
        if (content)
            data.content = String(content);
        if (typeof active === "boolean")
            data.active = active;
        const updated = await this.db.internalEmailTemplate.update({
            where: { id },
            data: data,
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
    async delete(user, id) {
        const accountId = await this.accountId(user);
        const existing = await this.db.internalEmailTemplate.findFirst({
            where: { id, account_id: accountId },
        });
        if (!existing) {
            throw new common_1.NotFoundException({ error: "Template not found" });
        }
        await this.db.internalEmailTemplate.delete({ where: { id } });
        return null;
    }
    async testEmail(user, id, body) {
        const accountId = await this.accountId(user);
        if (!body.emailSubject || !body.emailContent) {
            throw new common_1.BadRequestException({
                error: "Email subject and content are required",
            });
        }
        const template = await this.db.internalEmailTemplate.findFirst({
            where: { id, account_id: accountId },
            select: { id: true, account_id: true, name: true },
        });
        if (!template) {
            throw new common_1.NotFoundException({ error: "Template not found" });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const recipientEmail = user.email ||
            (await this.db.user.findUnique({
                where: { id: userInfo.userId },
                select: { email: true },
            }))?.email;
        if (!recipientEmail) {
            throw new common_1.BadRequestException({
                error: "No email address found for the current user",
            });
        }
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { name: true },
        });
        const result = await this.systemEmail.sendHtmlEmail({
            toEmail: recipientEmail,
            subject: body.emailSubject,
            html: body.emailContent,
            fromName: account?.name || "ARchaser",
        });
        return {
            success: true,
            message: "Test email sent successfully",
            messageId: result.messageId,
            templateId: template.id,
            subject: body.emailSubject,
        };
    }
};
exports.InternalEmailTemplatesService = InternalEmailTemplatesService;
exports.InternalEmailTemplatesService = InternalEmailTemplatesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService,
        system_email_service_1.SystemEmailService])
], InternalEmailTemplatesService);
//# sourceMappingURL=internal-email-templates.service.js.map