import {
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

export type InvoicesListQuery = {
    page?: string;
    limit?: string;
    search?: string;
    status?: string;
    customer_id?: string;
    sortField?: string;
    sortDirection?: string;
};

@Injectable()
export class InvoicesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    async list(user: JwtPayload, query: InvoicesListQuery) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const search = query.search || "";
        const status = query.status || "";
        const customerId = query.customer_id
            ? parseInt(query.customer_id, 10)
            : null;
        const sortField = query.sortField || "";
        const sortDirection = (query.sortDirection || "desc") as
            | "asc"
            | "desc";

        const andClause: Record<string, unknown>[] = [
            { account_id: accountId },
            ...(status ? [{ status }] : []),
            ...(customerId ? [{ customer_id: customerId }] : []),
        ];

        if (search) {
            andClause.push({
                invoice_number: { contains: search, mode: "insensitive" },
            });
        }

        const where = { AND: andClause };

        const map: Record<string, string> = {
            invoice_number: "invoice_number",
            due_date: "due_date",
            invoice_date: "invoice_date",
            amount: "amount",
            status: "status",
            created_at: "created_at",
        };
        const orderBy = sortField
            ? [{ [map[sortField] || "id"]: sortDirection }, { id: "desc" }]
            : [{ invoice_date: "desc" }, { id: "desc" }];

        const [invoices, totalRecords] = await Promise.all([
            this.db.invoice.findMany({
                where: where as never,
                orderBy: orderBy as never,
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    Customer: {
                        select: {
                            id: true,
                            customer_number: true,
                            Person: {
                                select: {
                                    first_name: true,
                                    last_name: true,
                                },
                            },
                            Company: { select: { name: true } },
                        },
                    },
                },
            }),
            this.db.invoice.count({ where: where as never }),
        ]);

        return serializeBigInt({ invoices, totalRecords, page, limit });
    }

    async getById(user: JwtPayload, id: number) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const invoice = await this.db.invoice.findFirst({
            where: { id, account_id: accountId },
            include: {
                Customer: {
                    select: {
                        id: true,
                        customer_number: true,
                        Person: {
                            select: { first_name: true, last_name: true },
                        },
                        Company: { select: { name: true } },
                    },
                },
                InvoicePayment: true,
                DisputeInvoice: true,
            },
        });

        if (!invoice) {
            throw new NotFoundException({
                error: "Invoice not found",
                code: "INVOICE_NOT_FOUND",
            });
        }

        return serializeBigInt(invoice);
    }

    async update(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const existing = await this.db.invoice.findFirst({
            where: { id, account_id: accountId },
            select: { id: true },
        });
        if (!existing) {
            throw new NotFoundException({
                error: "Invoice not found",
                code: "INVOICE_NOT_FOUND",
            });
        }

        const data: Record<string, unknown> = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.customer_id;
        delete data.Customer;
        delete data.InvoicePayment;
        delete data.DisputeInvoice;
        delete data.created_at;
        delete data.created_by;

        if ("account_id" in body || "customer_id" in body) {
            throw new ForbiddenException({
                error: "account_id / customer_id cannot be changed",
            });
        }

        const updated = await this.db.invoice.update({
            where: { id },
            data: data as never,
        });

        return serializeBigInt(updated);
    }
}
