import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import { SystemEmailService } from "../email/system-email.service";

@Injectable()
export class InternalEmailTemplatesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService,
        private readonly systemEmail: SystemEmailService
    ) {}

    private async accountId(user: JwtPayload): Promise<number> {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveAccountId(userInfo);
    }

    async list(user: JwtPayload) {
        const accountId = await this.accountId(user);
        const templates = await this.db.internalEmailTemplate.findMany({
            where: { account_id: accountId },
            orderBy: { type: "asc" },
        });
        return serializeBigInt(templates || []);
    }

    async listMaster(type?: string) {
        if (type) {
            const template = await this.db.internalEmailTemplate.findFirst({
                where: {
                    type: type as never,
                    master_template: true,
                    active: true,
                },
            });
            if (!template) {
                throw new NotFoundException({
                    error: "Master template not found",
                });
            }
            return serializeBigInt(template);
        }

        const templates = await this.db.internalEmailTemplate.findMany({
            where: { master_template: true, active: true },
            orderBy: { type: "asc" },
        });
        return serializeBigInt(templates);
    }

    async getById(user: JwtPayload, id: number) {
        const accountId = await this.accountId(user);
        const template = await this.db.internalEmailTemplate.findFirst({
            where: { id, account_id: accountId },
        });
        if (!template) {
            throw new NotFoundException({ error: "Template not found" });
        }
        return serializeBigInt(template);
    }

    async create(user: JwtPayload, body: Record<string, unknown>) {
        const accountId = await this.accountId(user);
        const { name, type, subject, content } = body;
        if (!name || !type || !subject || !content) {
            throw new BadRequestException({
                error: "Missing required fields",
            });
        }

        const template = await this.db.internalEmailTemplate.create({
            data: {
                name: String(name),
                type: type as never,
                subject: String(subject),
                content: String(content),
                account_id: accountId,
                master_template: false,
            },
        });
        return serializeBigInt(template);
    }

    async update(user: JwtPayload, id: number, body: Record<string, unknown>) {
        const accountId = await this.accountId(user);
        const existing = await this.db.internalEmailTemplate.findFirst({
            where: { id, account_id: accountId },
        });
        if (!existing) {
            throw new NotFoundException({ error: "Template not found" });
        }

        const { name, subject, content, active } = body;
        const data: Record<string, unknown> = {};
        if (name) data.name = String(name);
        if (subject) data.subject = String(subject);
        if (content) data.content = String(content);
        if (typeof active === "boolean") data.active = active;

        const updated = await this.db.internalEmailTemplate.update({
            where: { id },
            data: data as never,
        });
        return serializeBigInt(updated);
    }

    async delete(user: JwtPayload, id: number) {
        const accountId = await this.accountId(user);
        const existing = await this.db.internalEmailTemplate.findFirst({
            where: { id, account_id: accountId },
        });
        if (!existing) {
            throw new NotFoundException({ error: "Template not found" });
        }
        await this.db.internalEmailTemplate.delete({ where: { id } });
        return null;
    }

    /**
     * Send a test email for an internal email template to the current user.
     */
    async testEmail(
        user: JwtPayload,
        id: number,
        body: { emailSubject?: string; emailContent?: string }
    ) {
        const accountId = await this.accountId(user);
        if (!body.emailSubject || !body.emailContent) {
            throw new BadRequestException({
                error: "Email subject and content are required",
            });
        }

        const template = await this.db.internalEmailTemplate.findFirst({
            where: { id, account_id: accountId },
            select: { id: true, account_id: true, name: true },
        });
        if (!template) {
            throw new NotFoundException({ error: "Template not found" });
        }

        const userInfo = await this.accessScope.resolveUserInfo(user);
        const recipientEmail =
            user.email ||
            (
                await this.db.user.findUnique({
                    where: { id: userInfo.userId },
                    select: { email: true },
                })
            )?.email;
        if (!recipientEmail) {
            throw new BadRequestException({
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
}
