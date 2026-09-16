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

export type ContactsListQuery = {
    page?: string;
    limit?: string;
    search?: string;
    company_id?: string;
    customer_id?: string;
    status?: string;
    role?: string;
    operation?: string;
    contactId?: string;
};

const CONTACT_STRING_KEYS = [
    "first_name",
    "last_name",
    "email",
    "phone",
    "mobile",
    "role",
    "erp_contact_id",
    "generic_text1",
    "generic_text2",
] as const;

const CONTACT_BOOL_KEYS = [
    "company_wide_address",
    "receives_standard_reminder",
    "receives_escalated_reminder",
] as const;

const CONTACT_ENUM_KEYS = [
    "status",
    "email_status",
    "mobile_status",
    "preferred_communication",
    "priority_level",
    "communication_priority",
] as const;

function parseOptionalInt(value: unknown): number | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === "") {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function parseOptionalDate(value: unknown): Date | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === "") {
        return null;
    }
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
}

function parseOptionalFloat(value: unknown): number | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === "") {
        return null;
    }
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
}

function buildFullName(
    firstName: string | null | undefined,
    lastName: string | null | undefined
): string | null {
    const full = `${firstName || ""} ${lastName || ""}`.trim();
    return full || null;
}

/** True when the body is a status-only deactivate/activate payload. */
function isStatusOnlyBody(body: Record<string, unknown>): boolean {
    const keys = Object.keys(body).filter(
        (k) => body[k] !== undefined && k !== "id"
    );
    return keys.length === 1 && keys[0] === "status";
}

@Injectable()
export class ContactsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    async list(user: JwtPayload, query: ContactsListQuery) {
        if (query.operation === "availability") {
            return this.getAvailability(user, query.contactId);
        }

        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "50", 10);
        const search = query.search || "";

        const andClause: Record<string, unknown>[] = [
            { Customer: { account_id: accountId } },
            ...(query.company_id
                ? [{ company_id: parseInt(query.company_id, 10) }]
                : []),
            ...(query.customer_id
                ? [{ customer_id: parseInt(query.customer_id, 10) }]
                : []),
            ...(query.status
                ? [
                      {
                          status:
                              query.status === "1" ||
                              query.status === "Active"
                                  ? "Active"
                                  : "Inactive",
                      },
                  ]
                : []),
            ...(query.role
                ? [{ role: { contains: query.role, mode: "insensitive" } }]
                : []),
        ];

        if (search) {
            andClause.push({
                OR: [
                    {
                        first_name: {
                            contains: search,
                            mode: "insensitive",
                        },
                    },
                    { last_name: { contains: search, mode: "insensitive" } },
                    { email: { contains: search, mode: "insensitive" } },
                    { phone: { contains: search, mode: "insensitive" } },
                    { mobile: { contains: search, mode: "insensitive" } },
                ],
            });
        }

        const where = { AND: andClause };

        const [contacts, totalRecords] = await Promise.all([
            this.db.contact.findMany({
                where: where as never,
                include: {
                    Company: { select: { id: true, name: true } },
                    Country: { select: { id: true, name: true } },
                },
                orderBy: { first_name: "asc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.contact.count({ where: where as never }),
        ]);

        return serializeBigInt({
            contacts,
            totalRecords,
            page,
            limit,
            totalPages: Math.ceil(totalRecords / limit) || 1,
        });
    }

    /**
     * FE: GET /entities/contacts?operation=availability&contactId=
     * Stores schedule JSON on Contact.availability_schedule.
     */
    async getAvailability(user: JwtPayload, contactIdRaw?: string) {
        const contactId = parseOptionalInt(contactIdRaw);
        if (contactId == null) {
            throw new BadRequestException({
                error: "contactId is required for availability",
            });
        }

        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        await this.assertContactInAccount(accountId, contactId);

        const contact = await this.db.contact.findFirst({
            where: { id: contactId },
            select: {
                availability_schedule: true,
                preferred_channels: true,
            },
        });

        const schedule = contact?.availability_schedule;
        if (schedule && typeof schedule === "object" && !Array.isArray(schedule)) {
            return { availability: schedule };
        }

        return {
            availability: {
                businessHours: {
                    start: "09:00",
                    end: "18:00",
                    timezone: "UTC",
                    daysOfWeek: [1, 2, 3, 4, 5],
                },
                preferredChannels:
                    contact?.preferred_channels?.length
                        ? contact.preferred_channels
                        : ["email", "sms"],
                urgencyLevels: {
                    urgent: true,
                    emergency: true,
                },
            },
        };
    }

    /**
     * FE: PUT /entities/contacts?operation=availability&contactId=
     * Body: `{ availability: ContactAvailability }`
     */
    async updateAvailability(
        user: JwtPayload,
        query: ContactsListQuery,
        body: Record<string, unknown>
    ) {
        if (query.operation !== "availability") {
            throw new BadRequestException({
                error: "Unsupported collection PUT; use /contacts/:id or operation=availability",
            });
        }

        const contactId = parseOptionalInt(query.contactId);
        if (contactId == null) {
            throw new BadRequestException({
                error: "contactId is required for availability",
            });
        }

        const availability = body.availability;
        if (
            !availability ||
            typeof availability !== "object" ||
            Array.isArray(availability)
        ) {
            throw new BadRequestException({
                error: "availability object is required",
            });
        }

        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveUserId = this.accessScope.getEffectiveUserId(userInfo);
        await this.assertContactInAccount(accountId, contactId);

        const preferredChannels = Array.isArray(
            (availability as { preferredChannels?: unknown }).preferredChannels
        )
            ? (
                  (availability as { preferredChannels: unknown[] })
                      .preferredChannels
              ).map(String)
            : undefined;

        await this.db.contact.update({
            where: { id: contactId },
            data: {
                availability_schedule: availability as never,
                ...(preferredChannels
                    ? { preferred_channels: preferredChannels }
                    : {}),
                modified_by: effectiveUserId,
            } as never,
        });

        return { ok: true, availability };
    }

    async getById(user: JwtPayload, id: number) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const contact = await this.db.contact.findFirst({
            where: {
                id,
                OR: [
                    { Customer: { account_id: accountId } },
                    { customer_id: null },
                ],
            },
            include: {
                Company: { select: { id: true, name: true } },
                Country: { select: { id: true, name: true } },
                State: { select: { id: true, name: true } },
            },
        });

        if (!contact) {
            throw new NotFoundException({ error: "Contact not found" });
        }

        return serializeBigInt(contact);
    }

    /**
     * FE UpsertContactModal POSTs create (no id) and update (id in body)
     * to the same `/entities/contacts` route.
     */
    async upsert(user: JwtPayload, body: Record<string, unknown>) {
        const id = parseOptionalInt(body.id);
        if (id != null && id > 0) {
            return this.updateFull(user, id, body);
        }
        return this.create(user, body);
    }

    async create(user: JwtPayload, body: Record<string, unknown>) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveUserId = this.accessScope.getEffectiveUserId(userInfo);

        const firstName = String(body.first_name ?? "").trim();
        if (!firstName) {
            throw new BadRequestException({ error: "first_name is required" });
        }

        const companyId = parseOptionalInt(body.company_id);
        if (companyId == null) {
            throw new BadRequestException({ error: "company_id is required" });
        }

        const customerId = parseOptionalInt(body.customer_id);
        await this.assertCompanyAndCustomerInAccount(
            accountId,
            companyId,
            customerId
        );

        const data = this.buildContactWriteData(body, {
            requireFirstName: true,
            firstNameFallback: firstName,
        });
        data.company_id = companyId;
        if (customerId !== undefined) {
            data.customer_id = customerId;
        }
        data.created_by = effectiveUserId;
        data.modified_by = effectiveUserId;
        if (data.full_name === undefined) {
            data.full_name = buildFullName(
                firstName,
                data.last_name as string | null | undefined
            );
        }

        const created = await this.db.contact.create({
            data: data as never,
            include: {
                Company: { select: { id: true, name: true } },
                Country: { select: { id: true, name: true } },
                State: { select: { id: true, name: true } },
            },
        });

        return serializeBigInt(created);
    }

    /**
     * PUT /contacts/:id — status-only deactivate, or full update when more fields sent.
     */
    async update(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        if (isStatusOnlyBody(body) || body.status !== undefined) {
            const keys = Object.keys(body).filter((k) => body[k] !== undefined);
            if (keys.length <= 2 && keys.every((k) => k === "status" || k === "id")) {
                return this.updateStatus(user, id, body);
            }
        }
        return this.updateFull(user, id, body);
    }

    async updateStatus(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveUserId = this.accessScope.getEffectiveUserId(userInfo);

        await this.assertContactInAccount(accountId, id);

        const status = body.status as string | undefined;
        if (status === undefined) {
            throw new BadRequestException({
                error: "Status field is required for contact status updates",
            });
        }

        const updated = await this.db.contact.update({
            where: { id },
            data: {
                status: status === "Active" ? "Active" : "Inactive",
                modified_by: effectiveUserId,
            } as never,
        });

        return serializeBigInt(updated);
    }

    async updateFull(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveUserId = this.accessScope.getEffectiveUserId(userInfo);

        const existing = await this.assertContactInAccount(accountId, id);

        const companyId = parseOptionalInt(body.company_id);
        const customerId = parseOptionalInt(body.customer_id);
        await this.assertCompanyAndCustomerInAccount(
            accountId,
            companyId ?? existing.company_id,
            customerId !== undefined ? customerId : existing.customer_id
        );

        const data = this.buildContactWriteData(body, {
            requireFirstName: false,
        });
        if (companyId != null) {
            data.company_id = companyId;
        }
        if (customerId !== undefined) {
            data.customer_id = customerId;
        }
        data.modified_by = effectiveUserId;

        const nextFirst =
            (data.first_name as string | undefined) ?? existing.first_name;
        const nextLast =
            data.last_name !== undefined
                ? (data.last_name as string | null)
                : existing.last_name;
        if (data.first_name !== undefined || data.last_name !== undefined) {
            data.full_name = buildFullName(nextFirst, nextLast);
        }

        const updated = await this.db.contact.update({
            where: { id },
            data: data as never,
            include: {
                Company: { select: { id: true, name: true } },
                Country: { select: { id: true, name: true } },
                State: { select: { id: true, name: true } },
            },
        });

        return serializeBigInt(updated);
    }

    async remove(user: JwtPayload, id: number) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        await this.assertContactInAccount(accountId, id);

        try {
            await this.db.contact.delete({ where: { id } });
        } catch {
            throw new ForbiddenException({
                error: "Contact cannot be deleted because it is referenced by other records",
            });
        }

        return { ok: true, id };
    }

    private buildContactWriteData(
        body: Record<string, unknown>,
        opts: { requireFirstName: boolean; firstNameFallback?: string }
    ): Record<string, unknown> {
        const data: Record<string, unknown> = {};

        for (const key of CONTACT_STRING_KEYS) {
            if (!(key in body)) {
                continue;
            }
            const raw = body[key];
            if (raw === null || raw === "") {
                if (key === "first_name") {
                    if (opts.requireFirstName) {
                        throw new BadRequestException({
                            error: "first_name is required",
                        });
                    }
                    continue;
                }
                data[key] = null;
                continue;
            }
            data[key] = String(raw).trim();
        }

        if (
            opts.requireFirstName &&
            data.first_name == null &&
            opts.firstNameFallback
        ) {
            data.first_name = opts.firstNameFallback;
        }

        for (const key of CONTACT_BOOL_KEYS) {
            if (!(key in body)) {
                continue;
            }
            data[key] = Boolean(body[key]);
        }

        for (const key of CONTACT_ENUM_KEYS) {
            if (!(key in body) || body[key] === undefined) {
                continue;
            }
            if (body[key] === null || body[key] === "") {
                data[key] = null;
                continue;
            }
            data[key] = String(body[key]);
        }

        if ("state_id" in body) {
            data.state_id = parseOptionalInt(body.state_id);
        }
        if ("country_id" in body) {
            data.country_id = parseOptionalInt(body.country_id);
        }
        if ("fallback_contact_id" in body) {
            data.fallback_contact_id = parseOptionalInt(body.fallback_contact_id);
        }
        if ("date_of_birth" in body) {
            data.date_of_birth = parseOptionalDate(body.date_of_birth);
        }
        if ("generic_date1" in body) {
            data.generic_date1 = parseOptionalDate(body.generic_date1);
        }
        if ("generic_date2" in body) {
            data.generic_date2 = parseOptionalDate(body.generic_date2);
        }
        if ("generic_number1" in body) {
            data.generic_number1 = parseOptionalFloat(body.generic_number1);
        }
        if ("generic_number2" in body) {
            data.generic_number2 = parseOptionalFloat(body.generic_number2);
        }

        return data;
    }

    private async assertContactInAccount(accountId: number, id: number) {
        const contact = await this.db.contact.findFirst({
            where: {
                id,
                OR: [
                    { Customer: { account_id: accountId } },
                    {
                        customer_id: null,
                        Company: {
                            Customer: { some: { account_id: accountId } },
                        },
                    },
                ],
            },
            select: {
                id: true,
                company_id: true,
                customer_id: true,
                first_name: true,
                last_name: true,
            },
        });
        if (!contact) {
            throw new NotFoundException({ error: "Contact not found" });
        }
        return contact;
    }

    private async assertCompanyAndCustomerInAccount(
        accountId: number,
        companyId: number | null | undefined,
        customerId: number | null | undefined
    ) {
        if (companyId != null) {
            const linked = await this.db.customer.findFirst({
                where: { company_id: companyId, account_id: accountId },
                select: { id: true },
            });
            if (!linked) {
                const companyExists = await this.db.company.findFirst({
                    where: { id: companyId },
                    select: { id: true },
                });
                if (!companyExists) {
                    throw new ForbiddenException({
                        error: "Company not found in account",
                    });
                }
                // Brand-new company with no customers yet is rare; still allow
                // when the contact carries a customer_id in this account.
                if (customerId == null) {
                    throw new ForbiddenException({
                        error: "Company not found in account",
                    });
                }
            }
        }

        if (customerId != null) {
            const customer = await this.db.customer.findFirst({
                where: { id: customerId, account_id: accountId },
                select: { id: true, company_id: true },
            });
            if (!customer) {
                throw new ForbiddenException({
                    error: "Customer not found in account",
                });
            }
            if (
                companyId != null &&
                customer.company_id != null &&
                customer.company_id !== companyId
            ) {
                throw new BadRequestException({
                    error: "company_id does not match customer",
                });
            }
        }
    }
}
