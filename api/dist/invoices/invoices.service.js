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
exports.InvoicesService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let InvoicesService = class InvoicesService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async list(user, query) {
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
        const sortDirection = (query.sortDirection || "desc");
        const andClause = [
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
        const map = {
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
                where: where,
                orderBy: orderBy,
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
            this.db.invoice.count({ where: where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({ invoices, totalRecords, page, limit });
    }
    async getById(user, id) {
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
            throw new common_1.NotFoundException({
                error: "Invoice not found",
                code: "INVOICE_NOT_FOUND",
            });
        }
        return (0, serialize_bigint_1.serializeBigInt)(invoice);
    }
    async update(user, id, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const existing = await this.db.invoice.findFirst({
            where: { id, account_id: accountId },
            select: { id: true },
        });
        if (!existing) {
            throw new common_1.NotFoundException({
                error: "Invoice not found",
                code: "INVOICE_NOT_FOUND",
            });
        }
        const data = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.customer_id;
        delete data.Customer;
        delete data.InvoicePayment;
        delete data.DisputeInvoice;
        delete data.created_at;
        delete data.created_by;
        if ("account_id" in body || "customer_id" in body) {
            throw new common_1.ForbiddenException({
                error: "account_id / customer_id cannot be changed",
            });
        }
        const updated = await this.db.invoice.update({
            where: { id },
            data: data,
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
};
exports.InvoicesService = InvoicesService;
exports.InvoicesService = InvoicesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], InvoicesService);
//# sourceMappingURL=invoices.service.js.map