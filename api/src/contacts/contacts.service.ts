import {
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
};

@Injectable()
export class ContactsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    async list(user: JwtPayload, query: ContactsListQuery) {
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

    async update(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveUserId = this.accessScope.getEffectiveUserId(userInfo);

        const contact = await this.db.contact.findFirst({
            where: {
                id,
                OR: [
                    { Customer: { account_id: accountId } },
                    { customer_id: null },
                ],
            },
        });
        if (!contact) {
            throw new NotFoundException({ error: "Contact not found" });
        }

        const status = body.status as string | undefined;
        if (status === undefined) {
            throw new ForbiddenException({
                error: "Status field is required for contact updates",
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
}
