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
exports.ContactsService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let ContactsService = class ContactsService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async list(user, query) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "50", 10);
        const search = query.search || "";
        const andClause = [
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
                        status: query.status === "1" ||
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
                where: where,
                include: {
                    Company: { select: { id: true, name: true } },
                    Country: { select: { id: true, name: true } },
                },
                orderBy: { first_name: "asc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.contact.count({ where: where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({
            contacts,
            totalRecords,
            page,
            limit,
            totalPages: Math.ceil(totalRecords / limit) || 1,
        });
    }
    async getById(user, id) {
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
            throw new common_1.NotFoundException({ error: "Contact not found" });
        }
        return (0, serialize_bigint_1.serializeBigInt)(contact);
    }
    async update(user, id, body) {
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
            throw new common_1.NotFoundException({ error: "Contact not found" });
        }
        const status = body.status;
        if (status === undefined) {
            throw new common_1.ForbiddenException({
                error: "Status field is required for contact updates",
            });
        }
        const updated = await this.db.contact.update({
            where: { id },
            data: {
                status: status === "Active" ? "Active" : "Inactive",
                modified_by: effectiveUserId,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
};
exports.ContactsService = ContactsService;
exports.ContactsService = ContactsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], ContactsService);
//# sourceMappingURL=contacts.service.js.map