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
export class SmsCountryVendorsService {
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

    async list(user: JwtPayload, query: Record<string, string | undefined>) {
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

    async create(user: JwtPayload, body: Record<string, unknown>) {
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

    async getById(user: JwtPayload, id: number) {
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

    async update(
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

    async remove(user: JwtPayload, id: number) {
        this.assertAdmin(user);
        await this.db.countrySMSVendor.delete({ where: { id } });
        return { success: true };
    }
}
