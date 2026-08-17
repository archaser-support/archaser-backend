import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

const ADMIN_ACCOUNT_ID = 10013;

const SMS_PREF_INCLUDE = {
    Country: {
        select: {
            id: true,
            name: true,
            iso2: true,
            iso3: true,
            phonecode: true,
            emoji: true,
        },
    },
    SMSVendor: {
        select: {
            id: true,
            name: true,
            provider: true,
            is_active: true,
            priority: true,
            cost_per_sms: true,
            currency: true,
        },
    },
} as const;

@Injectable()
export class AccountsSmsPreferencesService {
    constructor(private readonly db: DatabaseService) {}

    private assertAdmin(user: JwtPayload) {
        const isAdmin =
            user.role === "Admin" ||
            user.role === "archaser_admin" ||
            user.account_id === ADMIN_ACCOUNT_ID;
        if (!isAdmin) {
            throw new ForbiddenException({
                error: "Forbidden - Admin access required",
            });
        }
    }

    async list(user: JwtPayload, accountId: number, countryId?: string) {
        this.assertAdmin(user);
        const where: Record<string, unknown> = { account_id: accountId };
        if (countryId) {
            where.country_id = parseInt(countryId, 10);
        }
        const preferences =
            await this.db.accountSMSProviderPreferences.findMany({
                where,
                include: SMS_PREF_INCLUDE,
                orderBy: [{ priority: "asc" }, { created_at: "desc" }],
            });
        return serializeBigInt(preferences);
    }

    async create(
        user: JwtPayload,
        accountId: number,
        body: Record<string, unknown>
    ) {
        this.assertAdmin(user);
        const countryId = Number(body.country_id);
        const vendorId = Number(body.vendor_id);
        const priority = Number(body.priority ?? 1);
        if (!Number.isFinite(countryId) || !Number.isFinite(vendorId)) {
            throw new BadRequestException({
                error: "country_id and vendor_id are required",
            });
        }
        const existing =
            await this.db.accountSMSProviderPreferences.findFirst({
                where: {
                    account_id: accountId,
                    country_id: countryId,
                    vendor_id: vendorId,
                },
            });
        if (existing) {
            throw new ConflictException({
                error: "Customer SMS provider preference already exists",
            });
        }
        const preference =
            await this.db.accountSMSProviderPreferences.create({
                data: {
                    account_id: accountId,
                    country_id: countryId,
                    vendor_id: vendorId,
                    is_enabled: body.is_enabled !== false,
                    priority: Number.isFinite(priority) ? priority : 1,
                },
                include: SMS_PREF_INCLUDE,
            });
        return serializeBigInt(preference);
    }

    async getById(
        user: JwtPayload,
        accountId: number,
        preferenceId: number
    ) {
        this.assertAdmin(user);
        const preference =
            await this.db.accountSMSProviderPreferences.findFirst({
                where: { id: preferenceId, account_id: accountId },
                include: SMS_PREF_INCLUDE,
            });
        if (!preference) {
            throw new NotFoundException({
                error: "Customer SMS provider preference not found",
            });
        }
        const countrySMSVendor = await this.db.countrySMSVendor.findFirst({
            where: {
                country_id: preference.country_id,
                vendor_id: preference.vendor_id,
            },
            select: { phone_number: true },
        });
        return serializeBigInt({
            ...preference,
            SMSVendor: {
                ...preference.SMSVendor,
                phone_number: countrySMSVendor?.phone_number ?? null,
            },
        });
    }

    async update(
        user: JwtPayload,
        accountId: number,
        preferenceId: number,
        body: Record<string, unknown>
    ) {
        this.assertAdmin(user);
        const existing =
            await this.db.accountSMSProviderPreferences.findFirst({
                where: { id: preferenceId, account_id: accountId },
            });
        if (!existing) {
            throw new NotFoundException({
                error: "Customer SMS provider preference not found",
            });
        }
        const data: Record<string, unknown> = { modified_at: new Date() };
        if (body.country_id != null) data.country_id = Number(body.country_id);
        if (body.vendor_id != null) data.vendor_id = Number(body.vendor_id);
        if (typeof body.is_enabled === "boolean")
            data.is_enabled = body.is_enabled;
        if (body.priority != null) data.priority = Number(body.priority);
        const preference =
            await this.db.accountSMSProviderPreferences.update({
                where: { id: preferenceId },
                data,
                include: SMS_PREF_INCLUDE,
            });
        return serializeBigInt(preference);
    }

    async remove(
        user: JwtPayload,
        accountId: number,
        preferenceId: number
    ) {
        this.assertAdmin(user);
        const existing =
            await this.db.accountSMSProviderPreferences.findFirst({
                where: { id: preferenceId, account_id: accountId },
            });
        if (!existing) {
            throw new NotFoundException({
                error: "Customer SMS provider preference not found",
            });
        }
        await this.db.accountSMSProviderPreferences.delete({
            where: { id: preferenceId },
        });
        return { success: true };
    }
}
