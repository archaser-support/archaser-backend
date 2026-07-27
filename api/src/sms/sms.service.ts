import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

const ADMIN_ACCOUNT_ID = 10013;

@Injectable()
export class SmsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    private assertAdmin(user: JwtPayload) {
        const isAdmin =
            user.role === "archaser_admin" ||
            user.account_id === ADMIN_ACCOUNT_ID;
        if (!isAdmin) {
            throw new ForbiddenException({
                error: "Forbidden - Admin access required",
            });
        }
    }

    async isBlockedForCountry(countryId: number): Promise<boolean> {
        const countryVendor = await this.db.countrySMSVendor.findFirst({
            where: {
                country_id: countryId,
                is_active: true,
                SMSVendor: { is_active: true },
            },
        });
        return !countryVendor;
    }

    async isBlockedForAccountCountry(
        accountId: number,
        countryId: number
    ): Promise<boolean> {
        const mapping = await this.db.accountSMSProviderPreferences.findFirst({
            where: {
                account_id: accountId,
                country_id: countryId,
                is_enabled: true,
                SMSVendor: { is_active: true },
            },
        });
        return !mapping;
    }

    async checkBlocking(
        _user: JwtPayload,
        countryId: number,
        accountId?: number
    ) {
        const isBlocked =
            accountId != null
                ? await this.isBlockedForAccountCountry(accountId, countryId)
                : await this.isBlockedForCountry(countryId);
        return {
            isBlocked,
            countryId,
            accountId,
        };
    }

    async checkBlockingWithActivities(
        _user: JwtPayload,
        countryId: number,
        accountId: number,
        customerId: number
    ) {
        const isBlocked = await this.isBlockedForAccountCountry(
            accountId,
            countryId
        );
        if (!isBlocked) {
            return {
                isBlocked: false,
                hasSMSActivities: false,
                countryId,
                accountId,
                customerId,
            };
        }
        const smsActivitiesCount = await this.db.activityContact.count({
            where: {
                Activity: { customer_id: customerId },
                communication_channel: "SMS",
            },
        });
        return {
            isBlocked: true,
            hasSMSActivities: smsActivitiesCount > 0,
            countryId,
            accountId,
            customerId,
        };
    }

    async listVendors(user: JwtPayload) {
        this.assertAdmin(user);
        const vendors = await this.db.sMSVendor.findMany({
            orderBy: [{ priority: "asc" }, { created_at: "desc" }],
        });
        return serializeBigInt(vendors);
    }

    async createVendor(user: JwtPayload, body: Record<string, unknown>) {
        this.assertAdmin(user);
        if (!body.provider) {
            throw new BadRequestException({ error: "Provider is required" });
        }
        const provider = String(body.provider);
        const vendor = await this.db.sMSVendor.create({
            data: {
                name: provider,
                provider,
                api_key: (body.api_key as string) || null,
                api_secret: (body.api_secret as string) || null,
                account_sid: (body.account_sid as string) || null,
                auth_token: (body.auth_token as string) || null,
                webhook_url: (body.webhook_url as string) || null,
                is_active: body.is_active !== false,
                priority: Number(body.priority ?? 1),
                cost_per_sms:
                    body.cost_per_sms != null
                        ? Number(body.cost_per_sms)
                        : null,
                currency: (body.currency as string) || "USD",
                use_account_sender_name:
                    body.use_account_sender_name === true,
            },
        });
        return serializeBigInt(vendor);
    }

    async getVendor(user: JwtPayload, id: number) {
        this.assertAdmin(user);
        const vendor = await this.db.sMSVendor.findUnique({ where: { id } });
        if (!vendor) {
            throw new NotFoundException({ error: "Vendor not found" });
        }
        return serializeBigInt(vendor);
    }

    async updateVendor(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        this.assertAdmin(user);
        const existing = await this.db.sMSVendor.findUnique({ where: { id } });
        if (!existing) {
            throw new NotFoundException({ error: "Vendor not found" });
        }
        const data: Record<string, unknown> = { modified_at: new Date() };
        for (const key of [
            "name",
            "provider",
            "api_key",
            "api_secret",
            "account_sid",
            "auth_token",
            "webhook_url",
            "currency",
        ]) {
            if (body[key] !== undefined) data[key] = body[key];
        }
        if (typeof body.is_active === "boolean") data.is_active = body.is_active;
        if (body.priority != null) data.priority = Number(body.priority);
        if (body.cost_per_sms != null)
            data.cost_per_sms = Number(body.cost_per_sms);
        if (typeof body.use_account_sender_name === "boolean") {
            data.use_account_sender_name = body.use_account_sender_name;
        }
        const vendor = await this.db.sMSVendor.update({ where: { id }, data });
        return serializeBigInt(vendor);
    }

    async deleteVendor(user: JwtPayload, id: number) {
        this.assertAdmin(user);
        await this.db.sMSVendor.delete({ where: { id } });
        return { success: true };
    }

    async listCountryVendors(
        user: JwtPayload,
        query: Record<string, string | undefined>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const isAdmin =
            userInfo.role === "archaser_admin" ||
            userInfo.accountId === ADMIN_ACCOUNT_ID;
        if (!isAdmin && !userInfo.accountId) {
            throw new ForbiddenException({ error: "Forbidden" });
        }
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "20", 10);
        const where: Record<string, unknown> = {};
        if (query.country_id) {
            where.country_id = parseInt(query.country_id, 10);
        }
        if (query.search) {
            where.OR = [
                {
                    Country: {
                        name: {
                            contains: query.search,
                            mode: "insensitive",
                        },
                    },
                },
                {
                    SMSVendor: {
                        name: {
                            contains: query.search,
                            mode: "insensitive",
                        },
                    },
                },
            ];
        }
        const [rows, total] = await Promise.all([
            this.db.countrySMSVendor.findMany({
                where,
                include: {
                    Country: {
                        select: {
                            id: true,
                            name: true,
                            iso2: true,
                            emoji: true,
                        },
                    },
                    SMSVendor: {
                        select: {
                            id: true,
                            name: true,
                            provider: true,
                            is_active: true,
                        },
                    },
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { id: "asc" },
            }),
            this.db.countrySMSVendor.count({ where }),
        ]);
        return serializeBigInt({
            countryVendors: rows,
            totalRecords: total,
            page,
            limit,
        });
    }

    async createCountryVendor(user: JwtPayload, body: Record<string, unknown>) {
        this.assertAdmin(user);
        const countryId = Number(body.country_id);
        const vendorId = Number(body.vendor_id);
        if (!Number.isFinite(countryId) || !Number.isFinite(vendorId)) {
            throw new BadRequestException({
                error: "country_id and vendor_id are required",
            });
        }
        const row = await this.db.countrySMSVendor.create({
            data: {
                country_id: countryId,
                vendor_id: vendorId,
                is_default: body.is_default === true,
                is_active: body.is_active !== false,
                phone_number: (body.phone_number as string) || null,
                cost_per_sms:
                    body.cost_per_sms != null
                        ? Number(body.cost_per_sms)
                        : null,
                currency: (body.currency as string) || "USD",
                comment: (body.comment as string) || null,
            },
            include: { Country: true, SMSVendor: true },
        });
        return serializeBigInt(row);
    }

    async getCountryVendor(user: JwtPayload, id: number) {
        this.assertAdmin(user);
        const row = await this.db.countrySMSVendor.findUnique({
            where: { id },
            include: { Country: true, SMSVendor: true },
        });
        if (!row) {
            throw new NotFoundException({ error: "Country vendor not found" });
        }
        return serializeBigInt(row);
    }

    async updateCountryVendor(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        this.assertAdmin(user);
        const data: Record<string, unknown> = {};
        if (body.country_id != null) data.country_id = Number(body.country_id);
        if (body.vendor_id != null) data.vendor_id = Number(body.vendor_id);
        if (typeof body.is_default === "boolean")
            data.is_default = body.is_default;
        if (typeof body.is_active === "boolean") data.is_active = body.is_active;
        if (body.phone_number !== undefined)
            data.phone_number = body.phone_number;
        if (body.cost_per_sms != null)
            data.cost_per_sms = Number(body.cost_per_sms);
        if (body.currency !== undefined) data.currency = body.currency;
        if (body.comment !== undefined) data.comment = body.comment;
        const row = await this.db.countrySMSVendor.update({
            where: { id },
            data,
            include: { Country: true, SMSVendor: true },
        });
        return serializeBigInt(row);
    }

    async deleteCountryVendor(user: JwtPayload, id: number) {
        this.assertAdmin(user);
        await this.db.countrySMSVendor.delete({ where: { id } });
        return { success: true };
    }

    async testSms(user: JwtPayload, body: Record<string, unknown>) {
        this.assertAdmin(user);
        const mobileNumber = body.mobileNumber;
        const content = body.content;
        if (!mobileNumber || !content) {
            throw new BadRequestException({
                error: "Mobile number and content are required",
            });
        }
        if (body.vendorId) {
            const vendor = await this.db.sMSVendor.findFirst({
                where: { id: Number(body.vendorId), is_active: true },
            });
            if (!vendor) {
                throw new BadRequestException({
                    error: "Vendor not found or inactive",
                });
            }
        }
        // Nest-native stub: validate inputs and return ack (no live Twilio send).
        return {
            success: true,
            message: "SMS test accepted (Nest-native stub — not sent)",
            mobileNumber,
            vendorId: body.vendorId ?? null,
            countryId: body.countryId ?? null,
        };
    }

    async handleTwilioWebhook(body: Record<string, unknown>) {
        const messageSid = String(body.MessageSid || "");
        const messageStatus = String(body.MessageStatus || "");
        if (!messageSid) {
            throw new BadRequestException({ error: "Missing MessageSid" });
        }
        let status: "Delivered" | "Failed" | "Sent" = "Sent";
        if (messageStatus === "delivered") status = "Delivered";
        else if (["failed", "undelivered"].includes(messageStatus))
            status = "Failed";

        const row = await this.db.activityContact.findFirst({
            where: {
                OR: [
                    { message_id: messageSid },
                    { vendor_message_id: messageSid },
                ],
            },
        });
        if (row) {
            const data: Record<string, unknown> = {
                status,
                modified_at: new Date(),
            };
            if (status === "Delivered") data.delivered_at = new Date();
            if (status === "Failed") {
                data.failed_at = new Date();
                data.failure_reason = body.ErrorMessage
                    ? String(body.ErrorMessage)
                    : null;
            }
            await this.db.activityContact.update({
                where: { id: row.id },
                data,
            });
        }
        return { success: true };
    }
}
