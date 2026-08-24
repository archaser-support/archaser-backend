import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from "@nestjs/common";
import {
    AccessScopeService,
    JwtPayload,
} from "@archaser/auth";
import {
    SendViaVendorOptions,
    TwilioClientFactory,
    buildWebhookUrl,
    sendViaVendor,
    validateTwilioWebhookSignature,
} from "@archaser/sms-send";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

const ADMIN_ACCOUNT_ID = 10013;

@Injectable()
export class SmsService {
    private readonly logger = new Logger(SmsService.name);
    private sendOptions: SendViaVendorOptions = {};

    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    /** Test seam — inject vendor client factories / fetch. */
    setSendOptions(options: SendViaVendorOptions) {
        this.sendOptions = options;
    }

    /** @deprecated Prefer setSendOptions */
    setTwilioClientFactory(factory: TwilioClientFactory) {
        this.sendOptions = {
            ...this.sendOptions,
            twilioClientFactory: factory,
        };
    }

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

    async listVendors(
        user: JwtPayload,
        query: Record<string, string | undefined> = {}
    ) {
        this.assertAdmin(user);
        const where: Record<string, unknown> = {};
        const searchTerm = String(query.search || "").trim();
        if (searchTerm) {
            const or: Record<string, unknown>[] = [
                { provider: { contains: searchTerm, mode: "insensitive" } },
                { name: { contains: searchTerm, mode: "insensitive" } },
                { currency: { contains: searchTerm, mode: "insensitive" } },
            ];
            if (/^\d+(\.\d+)?$/.test(searchTerm)) {
                const asNumber = Number(searchTerm);
                or.push({ priority: asNumber });
                or.push({ cost_per_sms: asNumber });
            }
            where.OR = or;
        }

        const vendors = await this.db.sMSVendor.findMany({
            where,
            orderBy: this.vendorOrderBy(query.sortField, query.sortDirection),
        });
        return serializeBigInt(vendors);
    }

    private vendorOrderBy(
        sortField?: string,
        sortDirection?: string
    ):
        | Record<string, "asc" | "desc">
        | Array<Record<string, "asc" | "desc">> {
        const dir = sortDirection === "desc" ? "desc" : "asc";
        const fieldMap: Record<string, string> = {
            provider: "provider",
            name: "name",
            priority: "priority",
            cost_per_sms: "cost_per_sms",
            currency: "currency",
            status: "is_active",
            is_active: "is_active",
            created_at: "created_at",
        };
        const prismaField = fieldMap[sortField || ""];
        if (prismaField) {
            return { [prismaField]: dir };
        }
        return [{ priority: "asc" }, { created_at: "desc" }];
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
                orderBy: this.countryVendorOrderBy(
                    query.sortField,
                    query.sortDirection
                ),
            }),
            this.db.countrySMSVendor.count({ where }),
        ]);
        return serializeBigInt({
            countryVendors: rows,
            mappings: rows,
            totalRecords: total,
            page,
            limit,
        });
    }

    private countryVendorOrderBy(
        sortField?: string,
        sortDirection?: string
    ):
        | Record<string, "asc" | "desc">
        | Record<string, Record<string, "asc" | "desc">> {
        const dir = sortDirection === "desc" ? "desc" : "asc";
        if (sortField === "country") {
            return { Country: { name: dir } };
        }
        if (sortField === "vendor") {
            return { SMSVendor: { name: dir } };
        }
        if (
            sortField === "phone_number" ||
            sortField === "cost_per_sms" ||
            sortField === "currency" ||
            sortField === "is_default" ||
            sortField === "is_active" ||
            sortField === "id"
        ) {
            return { [sortField]: dir };
        }
        return { id: "asc" };
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
        const mobileNumber = String(body.mobileNumber || "");
        const content = String(body.content || "");
        if (!mobileNumber || !content) {
            throw new BadRequestException({
                error: "Mobile number and content are required",
            });
        }

        let vendor =
            body.vendorId != null
                ? await this.db.sMSVendor.findFirst({
                      where: {
                          id: Number(body.vendorId),
                          is_active: true,
                      },
                  })
                : null;

        if (body.vendorId && !vendor) {
            throw new BadRequestException({
                error: "Vendor not found or inactive",
            });
        }

        if (!vendor && body.countryId != null) {
            const countryVendor = await this.db.countrySMSVendor.findFirst({
                where: {
                    country_id: Number(body.countryId),
                    is_active: true,
                    SMSVendor: { is_active: true },
                },
                include: { SMSVendor: true },
                orderBy: [
                    { is_default: "desc" },
                    { SMSVendor: { priority: "asc" } },
                ],
            });
            vendor = countryVendor?.SMSVendor ?? null;
        }

        if (!vendor) {
            vendor = await this.db.sMSVendor.findFirst({
                where: { is_active: true, provider: "twilio" },
                orderBy: { priority: "asc" },
            });
        }

        if (!vendor) {
            throw new BadRequestException({
                error: "No active SMS vendor available",
            });
        }

        const countryMapping =
            body.countryId != null
                ? await this.db.countrySMSVendor.findFirst({
                      where: {
                          country_id: Number(body.countryId),
                          vendor_id: vendor.id,
                          is_active: true,
                      },
                  })
                : null;

        const costPerSms =
            countryMapping?.cost_per_sms != null
                ? Number(countryMapping.cost_per_sms)
                : vendor.cost_per_sms != null
                  ? Number(vendor.cost_per_sms)
                  : null;

        const result = await sendViaVendor(
            {
                id: vendor.id,
                provider: vendor.provider,
                api_key: vendor.api_key,
                api_secret: vendor.api_secret,
                account_sid: vendor.account_sid,
                auth_token: vendor.auth_token,
                webhook_url: vendor.webhook_url,
                phone_number: countryMapping?.phone_number ?? null,
                cost_per_sms: costPerSms,
            },
            mobileNumber,
            String(body.from || countryMapping?.phone_number || "archaser"),
            content,
            this.sendOptions
        );

        if (!result.success) {
            throw new BadRequestException({
                error: result.error || "SMS send failed",
                vendorId: vendor.id,
            });
        }

        return {
            success: true,
            message: `SMS sent via ${vendor.provider}`,
            mobileNumber,
            vendorId: vendor.id,
            provider: vendor.provider,
            countryId: body.countryId ?? null,
            messageId: result.messageId ?? null,
            vendorMessageId: result.vendorMessageId ?? null,
            cost: result.cost ?? null,
            segments: result.segments ?? null,
        };
    }

    /**
     * Internal send used by api/worker (D32).
     * Body: { to, body, from?, vendorId?, countryId?, accountId? }
     */
    async sendInternal(body: Record<string, unknown>) {
        const to = String(body.to || body.mobileNumber || "");
        const content = String(body.body || body.content || "");
        if (!to || !content) {
            throw new BadRequestException({
                error: "to and body are required",
            });
        }
        return this.testSms(
            {
                sub: "internal",
                username: "internal",
                account_id: 10013,
                role: "archaser_admin",
            },
            {
                mobileNumber: to,
                content,
                from: body.from,
                vendorId: body.vendorId,
                countryId: body.countryId,
            }
        );
    }

    async handleTwilioWebhook(
        body: Record<string, unknown>,
        req: {
            headers: Record<string, string | string[] | undefined>;
            originalUrl?: string;
            url?: string;
        }
    ) {
        const vendorAuthToken =
            process.env.TWILIO_AUTH_TOKEN ||
            (await this.resolveTwilioAuthTokenForWebhook(body));

        if (!process.env.TWILIO_AUTH_TOKEN && !vendorAuthToken) {
            this.logger.warn(
                "TWILIO_AUTH_TOKEN / vendor auth_token missing — skipping webhook signature validation"
            );
        }

        const signatureHeader = req.headers["x-twilio-signature"];
        const signature = Array.isArray(signatureHeader)
            ? signatureHeader[0]
            : signatureHeader;

        const bodyForSig: Record<string, string> = {};
        for (const [k, v] of Object.entries(body)) {
            if (v != null) bodyForSig[k] = String(v);
        }

        const valid = validateTwilioWebhookSignature({
            authToken: vendorAuthToken,
            signature,
            url: buildWebhookUrl(req),
            body: bodyForSig,
        });
        if (!valid) {
            throw new UnauthorizedException({
                error: "Invalid Twilio webhook signature",
            });
        }

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

    private async resolveTwilioAuthTokenForWebhook(
        body: Record<string, unknown>
    ): Promise<string | undefined> {
        const accountSid = body.AccountSid
            ? String(body.AccountSid)
            : undefined;
        if (!accountSid) return undefined;
        const vendor = await this.db.sMSVendor.findFirst({
            where: { account_sid: accountSid, is_active: true },
            select: { auth_token: true },
        });
        return vendor?.auth_token || undefined;
    }
}
