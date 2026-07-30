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
const CONTENT_USER_TOKEN_RE = /\{\{user:([^}]+)\}\}/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR_PARAM_FIELDS = [
    { idField: "userId", nameField: "userName", fromCreator: true },
    { idField: "assigneeId", nameField: "assigneeName", fromCreator: false },
];
const SPECIAL_ACTOR_KEYS = new Map([
    ["system", "{{activities.values.system}}"],
    ["system_user", "{{activities.values.system}}"],
    ["system user", "{{activities.values.system}}"],
    ["portal_user", "{{users.values.portal_user}}"],
    ["portal user", "{{users.values.portal_user}}"],
]);
const UNKNOWN_ACTOR_KEY = "{{users.values.unknown_user}}";
function asParamsObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value;
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
const CALL_OUTCOME_TITLE_KEYS = {
    no_answer: "activity_no_answer_call",
    bad_number: "activity_bad_number_call",
    schedule_follow_up: "activity_follow_up_scheduled",
    general: "activity_general_call",
    add_new_contact: "activity_contact_added",
    promise_to_pay: "activity_promise_to_pay_call",
    open_dispute: "activity_general_call",
    generic_comment: "activity_comment_title_format",
};
const CALL_OUTCOME_LABEL_KEYS = {
    no_answer: "activities.values.outcomes_no_answer",
    bad_number: "activities.values.outcomes_bad_number",
    schedule_follow_up: "activities.values.outcomes_schedule_follow_up",
    general: "activities.values.outcomes_general",
    add_new_contact: "activities.values.outcomes_add_new_contact",
    promise_to_pay: "activities.values.outcomes_promise_to_pay",
    open_dispute: "activities.values.outcomes_open_dispute",
    generic_comment: "activities.values.outcomes_generic_comment",
};
const CALL_DIRECTION_LABEL_KEYS = {
    outgoing: "activities.values.call_direction_outgoing",
    incoming: "activities.values.call_direction_incoming",
};
const DISPUTABLE_INVOICE_STATUSES = ["Due", "Overdue"];
function parseIdList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const ids = value
        .map((entry) => parseInt(String(entry), 10))
        .filter((id) => Number.isFinite(id) && id > 0);
    return [...new Set(ids)];
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
                Account: {
                    select: {
                        promise_to_pay: true,
                        max_promise_to_pay_allowed_per_cycle: true,
                    },
                },
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
            activities: await this.hydrateActivityUsers(activities),
            totalRecords: activities.length,
        });
    }
    async hydrateActivityUsers(activities) {
        const ids = new Set();
        const collectId = (value) => {
            const raw = optionalTrimmed(value);
            if (raw && UUID_RE.test(raw)) {
                ids.add(raw);
            }
        };
        for (const activity of activities) {
            const content = optionalTrimmed(activity.content);
            if (content) {
                for (const [, token] of content.matchAll(CONTENT_USER_TOKEN_RE)) {
                    collectId(token);
                }
            }
            collectId(activity.created_by);
            const params = asParamsObject(activity.title_params);
            if (params) {
                for (const { idField } of ACTOR_PARAM_FIELDS) {
                    collectId(params[idField]);
                }
            }
        }
        const names = new Map();
        if (ids.size > 0) {
            const users = await this.db.user.findMany({
                where: { id: { in: [...ids] } },
                select: {
                    id: true,
                    name: true,
                    first_name: true,
                    last_name: true,
                },
            });
            for (const user of users) {
                const composed = `${user.first_name || ""} ${user.last_name || ""}`.trim();
                const display = optionalTrimmed(user.name) || optionalTrimmed(composed);
                if (display) {
                    names.set(user.id, display);
                }
            }
        }
        const resolveActor = (idValue, storedName) => {
            const raw = optionalTrimmed(idValue);
            const stored = optionalTrimmed(storedName);
            if (!raw) {
                return stored;
            }
            const special = SPECIAL_ACTOR_KEYS.get(raw.toLowerCase());
            if (special) {
                return special;
            }
            if (!UUID_RE.test(raw)) {
                return raw;
            }
            const resolved = names.get(raw);
            if (!resolved) {
                return stored || UNKNOWN_ACTOR_KEY;
            }
            return SPECIAL_ACTOR_KEYS.get(resolved.toLowerCase()) || resolved;
        };
        return activities.map((activity) => {
            const hydrated = { ...activity };
            if (optionalTrimmed(activity.content)) {
                hydrated.content = String(activity.content).replace(CONTENT_USER_TOKEN_RE, (match, token) => resolveActor(token, null) ?? match);
            }
            const params = asParamsObject(activity.title_params);
            if (params || optionalTrimmed(activity.title)) {
                const next = { ...(params || {}) };
                for (const { idField, nameField, fromCreator, } of ACTOR_PARAM_FIELDS) {
                    const idValue = next[idField] ??
                        (fromCreator ? activity.created_by : null);
                    const display = resolveActor(idValue, next[nameField]);
                    if (!display) {
                        continue;
                    }
                    next[idField] = display;
                    next[nameField] = display;
                }
                if (Object.keys(next).length > 0) {
                    hydrated.title_params = next;
                }
            }
            return hydrated;
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
                        policy_number: {
                            contains: search,
                            mode: "insensitive",
                        },
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
                orderBy: [
                    { [sortField]: sortDirection },
                    { id: "desc" },
                ],
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
            throw new common_1.NotFoundException({
                error: "Insurance policy not found",
            });
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
    async actingUserName(userId) {
        const user = await this.db.user.findFirst({
            where: { id: userId },
            select: { name: true, first_name: true, last_name: true },
        });
        if (!user) {
            return null;
        }
        const composed = `${user.first_name || ""} ${user.last_name || ""}`.trim();
        return optionalTrimmed(user.name) || optionalTrimmed(composed);
    }
    async openCollectionPeriod(customerId) {
        return this.db.customerCollectionPeriod.findFirst({
            where: { customer_id: customerId, period_end_date: null },
            select: { id: true, promise_to_pay_count: true },
            orderBy: { id: "desc" },
        });
    }
    async invoicesAvailableForDispute(user, id) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { accountId } = await this.assertCustomerInAccount(userInfo, id);
        const invoices = await this.db.invoice.findMany({
            where: {
                customer_id: id,
                account_id: accountId,
                status: { in: [...DISPUTABLE_INVOICE_STATUSES] },
                outstanding_debt: { gt: 0 },
            },
            select: {
                id: true,
                invoice_number: true,
                amount: true,
                outstanding_debt: true,
                customer_amount: true,
                customer_outstanding_debt: true,
                customer_currency: true,
                due_date: true,
                status: true,
            },
            orderBy: [{ due_date: "asc" }, { id: "asc" }],
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            invoices,
            totalRecords: invoices.length,
        });
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
        if (!CALL_OUTCOME_TITLE_KEYS[callOutcome]) {
            throw new common_1.BadRequestException({
                error: `Unsupported call outcome: ${callOutcome}`,
            });
        }
        const contactInput = (body.contact || null);
        const contactId = contactInput?.id
            ? parseInt(String(contactInput.id), 10)
            : NaN;
        let contact = null;
        if (Number.isFinite(contactId) && contactId > 0) {
            const found = await this.db.contact.findFirst({
                where: { id: contactId, customer_id: id },
                select: {
                    id: true,
                    full_name: true,
                    first_name: true,
                    last_name: true,
                },
            });
            if (!found) {
                throw new common_1.BadRequestException({
                    error: "Contact does not belong to this customer",
                });
            }
            contact = {
                id: found.id,
                name: optionalTrimmed(found.full_name) ||
                    `${found.first_name || ""} ${found.last_name || ""}`.trim(),
            };
        }
        const followUpTime = optionalTrimmed(body.follow_up_time);
        if (callOutcome === "schedule_follow_up" && !followUpTime) {
            throw new common_1.BadRequestException({
                error: "Follow-up time is required to schedule a follow-up",
            });
        }
        const promiseDate = callOutcome === "promise_to_pay"
            ? parseDateOnly(body.follow_up_time)
            : null;
        if (callOutcome === "promise_to_pay" && !promiseDate) {
            throw new common_1.BadRequestException({
                error: "A valid payment date (YYYY-MM-DD) is required for a promise to pay",
            });
        }
        const disputeInvoiceIds = parseIdList(body.disputed_invoices);
        const disputeReasonId = body.dispute_reason
            ? parseInt(String(body.dispute_reason), 10)
            : NaN;
        let disputeInvoices = [];
        if (callOutcome === "open_dispute") {
            if (disputeInvoiceIds.length === 0) {
                throw new common_1.BadRequestException({
                    error: "At least one invoice is required to open a dispute",
                });
            }
            if (!Number.isFinite(disputeReasonId)) {
                throw new common_1.BadRequestException({
                    error: "A dispute reason is required to open a dispute",
                });
            }
            disputeInvoices = await this.db.invoice.findMany({
                where: {
                    id: { in: disputeInvoiceIds },
                    customer_id: id,
                    account_id: accountId,
                },
                select: { id: true, invoice_number: true },
            });
            if (disputeInvoices.length !== disputeInvoiceIds.length) {
                throw new common_1.BadRequestException({
                    error: "One or more invoices do not belong to this customer",
                });
            }
        }
        const collectionPeriod = await this.openCollectionPeriod(id);
        const userName = await this.actingUserName(effectiveUserId);
        const now = new Date();
        const titleParams = {
            userId: effectiveUserId,
            ...(userName ? { userName } : {}),
        };
        if (contact) {
            titleParams.contact = contact.name;
        }
        if (callOutcome === "schedule_follow_up") {
            titleParams.time = followUpTime;
        }
        if (callOutcome === "general" ||
            callOutcome === "promise_to_pay" ||
            callOutcome === "open_dispute") {
            titleParams.outcome = CALL_OUTCOME_LABEL_KEYS[callOutcome];
            const direction = optionalTrimmed(body.call_direction);
            titleParams.callType = direction
                ? (CALL_DIRECTION_LABEL_KEYS[direction.toLowerCase()] ??
                    direction)
                : CALL_OUTCOME_LABEL_KEYS.general;
        }
        const duration = parseInt(String(body.duration ?? ""), 10);
        if (Number.isFinite(duration) && duration > 0) {
            titleParams.duration = duration;
        }
        const result = await this.db.$transaction(async (tx) => {
            const activity = await tx.activity.create({
                data: {
                    customer_id: id,
                    account_id: accountId,
                    type: "Call",
                    status: "COMPLETED",
                    title: `{{activities.fields.${CALL_OUTCOME_TITLE_KEYS[callOutcome]}}}`,
                    title_params: titleParams,
                    content: body.notes || "",
                    call_outcome: callOutcome,
                    contact_id: contact?.id ?? null,
                    collection_period_id: collectionPeriod?.id ?? null,
                    schedule_time: now,
                    actual_delivery_time: now,
                    created_by: effectiveUserId,
                },
            });
            if (contact) {
                await tx.activityContact.create({
                    data: {
                        activity_id: activity.id,
                        contact_id: contact.id,
                        communication_channel: "Call",
                        sent_at: now,
                        created_by: effectiveUserId,
                    },
                });
            }
            let dispute = null;
            if (callOutcome === "open_dispute") {
                dispute = await tx.customerDispute.create({
                    data: {
                        customer_id: id,
                        dispute_reason_id: disputeReasonId,
                        dispute_status: "Under_Review",
                        customer_comment: body.notes || "",
                        customer_collection_period_id: collectionPeriod?.id ?? null,
                        invoices_in_dispute: disputeInvoices
                            .map((inv) => inv.invoice_number)
                            .filter(Boolean)
                            .join(","),
                        owner_id: effectiveUserId,
                        created_by: effectiveUserId,
                    },
                    select: { id: true },
                });
                await tx.disputeInvoice.createMany({
                    data: disputeInvoices.map((inv) => ({
                        dispute_id: dispute.id,
                        invoice_id: inv.id,
                        created_by: effectiveUserId,
                    })),
                });
                const reason = await tx.disputeReason.findFirst({
                    where: { id: disputeReasonId },
                    select: { name: true },
                });
                await tx.activity.create({
                    data: {
                        customer_id: id,
                        account_id: accountId,
                        type: "Dispute",
                        status: "COMPLETED",
                        title: "{{activities.fields.dispute_opened}}",
                        title_params: {
                            userId: effectiveUserId,
                            ...(userName ? { userName } : {}),
                            disputeId: String(dispute.id),
                            disputeReason: reason?.name ?? "",
                        },
                        content: body.notes || "",
                        contact_id: contact?.id ?? null,
                        collection_period_id: collectionPeriod?.id ?? null,
                        schedule_time: now,
                        actual_delivery_time: now,
                        created_by: effectiveUserId,
                    },
                });
            }
            if (collectionPeriod) {
                const periodUpdate = {
                    last_call: now,
                    last_call_result: callOutcome,
                    modified_by: effectiveUserId,
                };
                if (promiseDate) {
                    periodUpdate.promise_to_pay_date = promiseDate;
                    periodUpdate.promise_to_pay_count = { increment: 1 };
                }
                if (callOutcome === "schedule_follow_up" && followUpTime) {
                    const parsed = new Date(followUpTime);
                    if (!Number.isNaN(parsed.getTime())) {
                        periodUpdate.follow_up_time = parsed;
                    }
                }
                if (callOutcome === "open_dispute") {
                    periodUpdate.last_dispute_date = now;
                }
                await tx.customerCollectionPeriod.update({
                    where: { id: collectionPeriod.id },
                    data: periodUpdate,
                });
            }
            return { activity, disputeId: dispute?.id ?? null };
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            ok: true,
            activity: result.activity,
            disputeId: result.disputeId,
            promiseToPayDate: promiseDate,
            durationSeconds: Number.isFinite(duration) ? duration : null,
        });
    }
    async sendEmailActivity(user, id, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { accountId, effectiveUserId } = await this.assertCustomerInAccount(userInfo, id);
        const contactIds = body.contactIds;
        const subject = body.subject;
        const emailBody = body.emailBody;
        if (!contactIds ||
            !Array.isArray(contactIds) ||
            contactIds.length === 0) {
            throw new common_1.BadRequestException({
                error: "At least one contact is required",
            });
        }
        if (!subject || !subject.trim()) {
            throw new common_1.BadRequestException({
                error: "Email subject is required",
            });
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
        return (0, serialize_bigint_1.serializeBigInt)({
            ok: true,
            activity: (0, serialize_bigint_1.serializeBigInt)(activity),
        });
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