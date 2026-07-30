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
exports.CustomersService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const domain_db_1 = require("../credit-insurance/domain-db");
const openReceivableByCustomerCurrency_1 = require("../credit-insurance/domain/openReceivableByCustomerCurrency");
const database_service_1 = require("../database/database.service");
const TOP_UP_SORT_FIELDS = new Set([
    "start_date",
    "end_date",
    "top_up_type",
    "top_up_value",
    "premium",
    "created_at",
]);
function optionalTrimmed(value) {
    if (value == null) {
        return null;
    }
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
}
function parseDateOnly(value) {
    const raw = optionalTrimmed(value);
    if (!raw) {
        return null;
    }
    const ymd = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        return null;
    }
    const parsed = new Date(`${ymd}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
const ACTIVITY_TYPES = [
    "SMS",
    "Email",
    "Call",
    "WhatsApp",
    "Internal",
    "Resolved",
    "Dispute",
    "Promise_to_pay",
    "Agent",
];
let CustomersService = class CustomersService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
        (0, domain_db_1.bindCreditInsurancePrisma)(this.db);
    }
    async listOrStats(user, query) {
        if (query.stats === "true") {
            return this.stats(user);
        }
        return this.list(user, query);
    }
    async list(user, query) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const search = query.search || "";
        const filter = query.filter || query.type || "All";
        const status = query.status || "";
        const sortField = query.sortField || "";
        const sortDirection = (query.sortDirection || "asc");
        const lastId = query.lastId ? parseInt(query.lastId, 10) : null;
        const skip = lastId ? 0 : (page - 1) * limit;
        const accessParts = await this.accessScope.buildCustomerAccessWhere(userInfo);
        const andClause = [
            ...accessParts,
            ...(filter !== "All" ? [{ type: filter }] : []),
            ...(status ? [{ collection_status: status }] : []),
        ];
        if (search) {
            andClause.push({
                OR: [
                    {
                        customer_number: {
                            contains: search,
                            mode: "insensitive",
                        },
                    },
                    {
                        Person: {
                            first_name: {
                                contains: search,
                                mode: "insensitive",
                            },
                        },
                    },
                    {
                        Person: {
                            last_name: {
                                contains: search,
                                mode: "insensitive",
                            },
                        },
                    },
                    {
                        Company: {
                            name: { contains: search, mode: "insensitive" },
                        },
                    },
                ],
            });
        }
        const where = { AND: andClause };
        let orderBy = [{ id: "asc" }];
        if (sortField) {
            const dir = sortDirection === "desc" ? "desc" : "asc";
            const map = {
                customer_number: "customer_number",
                created_at: "created_at",
                modified_at: "modified_at",
                collection_status: "collection_status",
                type: "type",
                name: "customer_number",
            };
            const field = map[sortField] || "id";
            orderBy = [{ [field]: dir }, { id: "asc" }];
        }
        const queryOptions = {
            take: limit,
            where,
            orderBy,
            include: {
                Person: true,
                Company: true,
                ParentCustomer: {
                    select: {
                        id: true,
                        customer_number: true,
                        type: true,
                        Person: {
                            select: {
                                first_name: true,
                                last_name: true,
                                full_name: true,
                            },
                        },
                        Company: { select: { name: true } },
                    },
                },
                Invoice: { where: { account_id: accountId } },
                CustomerCollectionPeriod: {
                    where: { period_end_date: null },
                    select: {
                        id: true,
                        current_category: true,
                        total_outstanding_amount: true,
                        no_of_overdue_invoices: true,
                        currency: true,
                        last_automated_step: true,
                        follow_up_time: true,
                        promise_to_pay_date: true,
                        promise_to_pay_count: true,
                        last_call_result: true,
                    },
                },
            },
        };
        if (lastId) {
            queryOptions.cursor = { id: lastId };
            queryOptions.skip = 1;
        }
        else {
            queryOptions.skip = skip;
        }
        const [customers, totalRecords] = await Promise.all([
            this.db.customer.findMany(queryOptions),
            this.db.customer.count({ where: where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({
            customers,
            totalRecords,
            page,
            limit,
        });
    }
    async stats(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accessParts = await this.accessScope.buildCustomerAccessWhere(userInfo);
        const where = { AND: accessParts };
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const [total, active, inactive, account] = await Promise.all([
            this.db.customer.count({ where: where }),
            this.db.customer.count({
                where: {
                    AND: [...accessParts, { collection_status: "Active" }],
                },
            }),
            this.db.customer.count({
                where: {
                    AND: [...accessParts, { collection_status: "Inactive" }],
                },
            }),
            this.db.account.findUnique({
                where: { id: accountId },
                select: { currency: true },
            }),
        ]);
        const customerAgg = await this.db.customer.aggregate({
            where: where,
            _sum: {
                total_due_amount: true,
                total_overdue_amount: true,
                no_of_due_invoices: true,
                number_of_overdue_invoices: true,
            },
        });
        const totalDue = Number(customerAgg._sum.total_due_amount ?? 0);
        const totalOverdue = Number(customerAgg._sum.total_overdue_amount ?? 0);
        const openInvoiceCount = Number(customerAgg._sum.no_of_due_invoices ?? 0) +
            Number(customerAgg._sum.number_of_overdue_invoices ?? 0);
        return {
            counts: {
                total_customers: total,
                active_customers: active,
                inactive_customers: inactive,
                total_due_amount: totalDue,
                total_overdue_amount: totalOverdue,
                open_invoice_count: openInvoiceCount,
                average_outstanding_per_customer: total > 0 ? totalDue / total : 0,
                currency: account?.currency ?? "USD",
            },
            category_distribution: [],
        };
    }
    async getById(user, id) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const hasViewAs = await this.accessScope.hasPermission(accountId, effectiveRole, "use_view_as");
        const exists = await this.db.customer.findUnique({
            where: { id },
            select: {
                id: true,
                account_id: true,
                owner_id: true,
                business_unit_id: true,
            },
        });
        if (!exists) {
            throw new common_1.NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }
        if (exists.account_id !== accountId) {
            throw new common_1.ForbiddenException({
                error: "Access denied",
                code: "ACCESS_DENIED_ACCOUNT",
            });
        }
        if (!isAdmin && !hasViewAs) {
            const effectiveUserId = this.accessScope.getEffectiveUserId(userInfo);
            const hasOwnerAccess = !exists.owner_id || exists.owner_id === effectiveUserId;
            if (!hasOwnerAccess) {
                throw new common_1.ForbiddenException({
                    error: "Access denied",
                    code: "ACCESS_DENIED_OWNER",
                });
            }
        }
        const customer = await this.db.customer.findFirst({
            where: { id, account_id: accountId },
            include: {
                Person: true,
                Company: true,
                Country: true,
                State: true,
                Owner: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        username: true,
                    },
                },
                ParentCustomer: true,
                CustomerCollectionPeriod: {
                    where: { period_end_date: null },
                },
                CustomerPolicy: {
                    include: {
                        InsurancePolicy: true,
                        User_CustomerPolicy_modified_byToUser: {
                            select: {
                                id: true,
                                name: true,
                                first_name: true,
                                last_name: true,
                                email: true,
                            },
                        },
                    },
                    orderBy: [{ is_active: "desc" }, { id: "desc" }],
                },
            },
        });
        if (!customer) {
            throw new common_1.NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }
        const { CustomerPolicy: customerPolicies, ...rest } = customer;
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { currency: true },
        });
        const headerAr = await (0, openReceivableByCustomerCurrency_1.resolveCustomerHeaderOpenArAmounts)({
            accountId,
            customerId: id,
            accountCurrency: account?.currency,
            customer,
            dbClient: this.db,
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            ...rest,
            ...headerAr,
            customerPolicies,
            activeCustomerPolicy: customerPolicies.find((policy) => policy.is_active) ?? null,
        });
    }
    async update(user, id, body) {
        await this.getById(user, id);
        if (body.customer_number !== undefined &&
            (body.customer_number === null ||
                String(body.customer_number).trim() === "")) {
            throw new common_1.ForbiddenException({
                error: "customer_number is required",
            });
        }
        const data = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.Person;
        delete data.Company;
        delete data.Owner;
        delete data.Country;
        delete data.State;
        delete data.ParentCustomer;
        delete data.CustomerCollectionPeriod;
        delete data.Invoice;
        delete data.CustomerPolicy;
        delete data.customerPolicies;
        delete data.activeCustomerPolicy;
        delete data.total_ar;
        delete data.total_ar_secondary;
        delete data.credit_insurance_secondary_currency;
        const updated = await this.db.customer.update({
            where: { id },
            data: data,
            include: {
                Country: true,
                State: true,
                Owner: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        username: true,
                    },
                },
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
    async assertCustomerInAccount(userInfo, id) {
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const exists = await this.db.customer.findFirst({
            where: { id, account_id: accountId },
            select: { id: true },
        });
        if (!exists) {
            throw new common_1.NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }
        return {
            accountId,
            effectiveUserId: this.accessScope.getEffectiveUserId(userInfo),
        };
    }
    async listActivities(user, id, query) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        await this.assertCustomerInAccount(userInfo, id);
        const limit = parseInt(query.limit || "10", 10);
        const lastId = query.last_id ? parseInt(query.last_id, 10) : null;
        const filterType = query.filter_type;
        const andClause = [{ customer_id: id }];
        if (lastId) {
            andClause.push({ id: { lt: BigInt(lastId) } });
        }
        if (filterType && ACTIVITY_TYPES.includes(filterType)) {
            andClause.push({ type: filterType });
        }
        const activities = await this.db.activity.findMany({
            where: { AND: andClause },
            orderBy: [{ schedule_time: "desc" }, { id: "desc" }],
            take: limit,
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            activities,
            totalRecords: activities.length,
        });
    }
    async listDisputes(user, id) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        await this.assertCustomerInAccount(userInfo, id);
        const disputes = await this.db.customerDispute.findMany({
            where: { customer_id: id },
            include: {
                DisputeReason: true,
                DisputeInvoice: {
                    include: {
                        Invoice: {
                            select: {
                                id: true,
                                invoice_number: true,
                                amount: true,
                                outstanding_debt: true,
                            },
                        },
                    },
                },
            },
            orderBy: { created_at: "desc" },
        });
        return (0, serialize_bigint_1.serializeBigInt)({ disputes, totalRecords: disputes.length });
    }
    async listPolicies(user, id) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        await this.assertCustomerInAccount(userInfo, id);
        const policies = await this.db.customerPolicy.findMany({
            where: { customer_id: id },
            include: { InsurancePolicy: true },
            orderBy: { id: "desc" },
        });
        return (0, serialize_bigint_1.serializeBigInt)({ policies, totalRecords: policies.length });
    }
    async listTopUps(user, id, query) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        await this.assertCustomerInAccount(userInfo, id);
        const page = Math.max(parseInt(query.page || "1", 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(query.limit || "50", 10) || 50, 1), 200);
        const search = (query.query || "").trim();
        const sortField = TOP_UP_SORT_FIELDS.has(query.sortField || "")
            ? query.sortField
            : "start_date";
        const sortDirection = query.sortDirection === "asc" ? "asc" : "desc";
        const where = { customer_id: id };
        if (search) {
            where.OR = [
                { notes: { contains: search, mode: "insensitive" } },
                {
                    InsurancePolicy: {
                        policy_number: { contains: search, mode: "insensitive" },
                    },
                },
                {
                    InsurancePolicy: {
                        insurer_name: { contains: search, mode: "insensitive" },
                    },
                },
            ];
        }
        const [rows, totalRecords] = await Promise.all([
            this.db.customerTopUp.findMany({
                where: where,
                include: {
                    InsurancePolicy: {
                        select: {
                            id: true,
                            policy_number: true,
                            insurer_name: true,
                        },
                    },
                },
                orderBy: [{ [sortField]: sortDirection }, { id: "desc" }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.customerTopUp.count({ where: where }),
        ]);
        const data = rows.map(({ InsurancePolicy, ...row }) => ({
            ...row,
            policy_number: InsurancePolicy?.policy_number ?? null,
            insurer_name: InsurancePolicy?.insurer_name ?? null,
        }));
        return (0, serialize_bigint_1.serializeBigInt)({ data, totalRecords, page, limit });
    }
    async createTopUp(user, id, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { accountId, effectiveUserId } = await this.assertCustomerInAccount(userInfo, id);
        const insurancePolicyId = Number(body.insurancePolicyId);
        if (!Number.isInteger(insurancePolicyId) || insurancePolicyId <= 0) {
            throw new common_1.BadRequestException({
                error: "insurancePolicyId is required",
            });
        }
        const topUpType = body.topUpType === "Percentage" ? "Percentage" : "Fixed";
        const topUpValue = Number(body.topUpValue);
        if (!Number.isFinite(topUpValue) || topUpValue <= 0) {
            throw new common_1.BadRequestException({
                error: "topUpValue must be a positive number",
            });
        }
        const currency = optionalTrimmed(body.currency);
        if (topUpType === "Fixed" && !currency) {
            throw new common_1.BadRequestException({
                error: "currency is required for a fixed top-up",
            });
        }
        const startDate = parseDateOnly(body.startDate);
        const endDate = parseDateOnly(body.endDate);
        if (!startDate) {
            throw new common_1.BadRequestException({ error: "startDate is required" });
        }
        if (!endDate) {
            throw new common_1.BadRequestException({ error: "endDate is required" });
        }
        if (endDate < startDate) {
            throw new common_1.BadRequestException({
                error: "endDate must be on or after startDate",
            });
        }
        let premium = null;
        if (body.premium != null && body.premium !== "") {
            premium = Number(body.premium);
            if (!Number.isFinite(premium) || premium < 0) {
                throw new common_1.BadRequestException({
                    error: "premium must be a positive number",
                });
            }
        }
        const premiumCurrency = optionalTrimmed(body.premiumCurrency);
        if (premium != null && !premiumCurrency) {
            throw new common_1.BadRequestException({
                error: "premiumCurrency is required when a premium is set",
            });
        }
        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: insurancePolicyId, account_id: accountId },
            select: { id: true, policy_kind: true },
        });
        if (!policy) {
            throw new common_1.NotFoundException({ error: "Insurance policy not found" });
        }
        if (policy.policy_kind !== "TopUp") {
            throw new common_1.BadRequestException({
                error: "Insurance policy is not a top-up policy",
            });
        }
        const topUp = await this.db.customerTopUp.create({
            data: {
                customer_id: id,
                insurance_policy_id: insurancePolicyId,
                top_up_type: topUpType,
                top_up_value: topUpValue,
                currency,
                start_date: startDate,
                end_date: endDate,
                notes: optionalTrimmed(body.notes),
                premium,
                premium_currency: premium == null ? null : premiumCurrency,
                created_by: effectiveUserId,
                modified_by: effectiveUserId,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(topUp);
    }
    async cancelTopUp(user, id, topUpId) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { effectiveUserId } = await this.assertCustomerInAccount(userInfo, id);
        const topUp = await this.db.customerTopUp.findFirst({
            where: { id: topUpId, customer_id: id },
            select: { id: true, cancelled_at: true },
        });
        if (!topUp) {
            throw new common_1.NotFoundException({ error: "Top-up not found" });
        }
        if (topUp.cancelled_at) {
            return (0, serialize_bigint_1.serializeBigInt)(topUp);
        }
        const cancelled = await this.db.customerTopUp.update({
            where: { id: topUpId },
            data: {
                cancelled_at: new Date(),
                modified_by: effectiveUserId,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(cancelled);
    }
    async stuckActivities(user, id) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { accountId } = await this.assertCustomerInAccount(userInfo, id);
        const customer = await this.db.customer.findFirst({
            where: { id, account_id: accountId },
            select: { automation_stuck_no_contacts: true },
        });
        return {
            stuck: !!customer?.automation_stuck_no_contacts,
        };
    }
    async logCallActivity(user, id, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { accountId, effectiveUserId } = await this.assertCustomerInAccount(userInfo, id);
        const callOutcome = body.call_outcome;
        if (!callOutcome) {
            throw new common_1.BadRequestException({
                error: "Call outcome is required",
            });
        }
        const activity = await this.db.activity.create({
            data: {
                customer_id: id,
                account_id: accountId,
                type: "Call",
                status: "COMPLETED",
                content: body.notes || "",
                call_outcome: callOutcome,
                schedule_time: new Date(),
                actual_delivery_time: new Date(),
                created_by: effectiveUserId,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(activity);
    }
    async sendEmailActivity(user, id, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { accountId, effectiveUserId } = await this.assertCustomerInAccount(userInfo, id);
        const contactIds = body.contactIds;
        const subject = body.subject;
        const emailBody = body.emailBody;
        if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
            throw new common_1.BadRequestException({
                error: "At least one contact is required",
            });
        }
        if (!subject || !subject.trim()) {
            throw new common_1.BadRequestException({ error: "Email subject is required" });
        }
        if (!emailBody || !emailBody.trim()) {
            throw new common_1.BadRequestException({ error: "Email body is required" });
        }
        const activity = await this.db.activity.create({
            data: {
                customer_id: id,
                account_id: accountId,
                type: "Email",
                status: "SENT",
                title: subject,
                content: emailBody,
                schedule_time: new Date(),
                actual_delivery_time: new Date(),
                created_by: effectiveUserId,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)({ ok: true, activity: (0, serialize_bigint_1.serializeBigInt)(activity) });
    }
    async updateDispute(user, id, disputeId, op, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        await this.assertCustomerInAccount(userInfo, id);
        const dispute = await this.db.customerDispute.findFirst({
            where: { id: disputeId, customer_id: id },
        });
        if (!dispute) {
            throw new common_1.NotFoundException({ error: "Dispute not found" });
        }
        const data = {};
        switch (op) {
            case "resolve":
            case "resolve-dispute":
                data.dispute_status = "Resolved";
                data.dispute_resolution = body.dispute_resolution || "Accepted";
                data.resolution_comment = body.resolution_comment ?? null;
                data.closed_at = new Date();
                break;
            case "cancel":
                data.dispute_status = "Cancelled";
                data.resolution_comment = body.resolution_comment ?? null;
                data.closed_at = new Date();
                break;
            case "assign":
            case "assign-user":
                data.owner_id = body.owner_id ?? body.userId ?? null;
                break;
            default: {
                const allowed = { ...body };
                delete allowed.id;
                delete allowed.customer_id;
                delete allowed.created_at;
                delete allowed.created_by;
                Object.assign(data, allowed);
            }
        }
        const updated = await this.db.customerDispute.update({
            where: { id: disputeId },
            data: data,
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
};
exports.CustomersService = CustomersService;
exports.CustomersService = CustomersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], CustomersService);
//# sourceMappingURL=customers.service.js.map