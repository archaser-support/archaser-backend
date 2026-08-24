import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import {
    AccessScopeService,
    AccessUserInfo,
} from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { bindCreditInsurancePrisma } from "../credit-insurance/domain-db";
import { enqueueAsOfRewrite } from "../credit-insurance/domain/asOfRewriteQueue";
import { resolveCustomerHeaderOpenArAmounts } from "../credit-insurance/domain/openReceivableByCustomerCurrency";
import { DatabaseService } from "../database/database.service";

export type CustomersListQuery = {
    page?: string;
    limit?: string;
    search?: string;
    filter?: string;
    type?: string;
    status?: string;
    sortField?: string;
    sortDirection?: string;
    lastId?: string;
    stats?: string;
};

export type CustomerActivityQuery = {
    limit?: string;
    last_id?: string;
    filter_type?: string;
};

export type CustomerTopUpsQuery = {
    page?: string;
    limit?: string;
    query?: string;
    sortField?: string;
    sortDirection?: string;
};

/** Sortable top-up columns, kept as an allow-list so the param can't reach Prisma raw. */
const TOP_UP_SORT_FIELDS = new Set([
    "start_date",
    "end_date",
    "top_up_type",
    "top_up_value",
    "premium",
    "created_at",
]);

function optionalTrimmed(value: unknown): string | null {
    if (value == null) {
        return null;
    }
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
}

/** Activity.content embeds the acting user as `{{user:<uuid>}}` or `{{user:<name>}}`. */
const CONTENT_USER_TOKEN_RE = /\{\{user:([^}]+)\}\}/g;
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `title_params` actor fields, paired with the name field the locale strings and
 * the client fall back to. Titles interpolate the id field verbatim, so it has to
 * carry a display name by the time it leaves the API. `fromCreator` marks the
 * actor that `Activity.created_by` can stand in for when the params carry none.
 */
const ACTOR_PARAM_FIELDS: ReadonlyArray<{
    idField: string;
    nameField: string;
    fromCreator: boolean;
}> = [
    { idField: "userId", nameField: "userName", fromCreator: true },
    { idField: "assigneeId", nameField: "assigneeName", fromCreator: false },
];

/**
 * Actors with no real User row, plus the sentinel accounts that stand in for
 * them. Mapped to keys so the client renders them in the viewer's language
 * instead of the English name stored on the sentinel.
 */
const SPECIAL_ACTOR_KEYS = new Map<string, string>([
    ["system", "{{activities.values.system}}"],
    ["system_user", "{{activities.values.system}}"],
    ["system user", "{{activities.values.system}}"],
    ["portal_user", "{{users.values.portal_user}}"],
    ["portal user", "{{users.values.portal_user}}"],
]);

const UNKNOWN_ACTOR_KEY = "{{users.values.unknown_user}}";

function asParamsObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

/** `start_date`/`end_date` are date-only columns; anchor at UTC midnight. */
function parseDateOnly(value: unknown): Date | null {
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

/**
 * Activity.title stores a wrapped i18n key and Activity.title_params the values
 * to interpolate — the timeline renders a row's text purely from those two, with
 * no outcome-based fallback. So every call outcome must map to a key that exists
 * in locales/<lang>/activities.json, or the row renders blank.
 */
const CALL_OUTCOME_TITLE_KEYS: Record<string, string> = {
    no_answer: "activity_no_answer_call",
    bad_number: "activity_bad_number_call",
    schedule_follow_up: "activity_follow_up_scheduled",
    general: "activity_general_call",
    add_new_contact: "activity_contact_added",
    promise_to_pay: "activity_promise_to_pay_call",
    open_dispute: "activity_general_call",
    generic_comment: "activity_comment_title_format",
};

/**
 * Outcome/direction params are stored as namespaced keys rather than English
 * text so the timeline resolves them per viewer language.
 */
const CALL_OUTCOME_LABEL_KEYS: Record<string, string> = {
    no_answer: "activities.values.outcomes_no_answer",
    bad_number: "activities.values.outcomes_bad_number",
    schedule_follow_up: "activities.values.outcomes_schedule_follow_up",
    general: "activities.values.outcomes_general",
    add_new_contact: "activities.values.outcomes_add_new_contact",
    promise_to_pay: "activities.values.outcomes_promise_to_pay",
    open_dispute: "activities.values.outcomes_open_dispute",
    generic_comment: "activities.values.outcomes_generic_comment",
};

const CALL_DIRECTION_LABEL_KEYS: Record<string, string> = {
    outgoing: "activities.values.call_direction_outgoing",
    incoming: "activities.values.call_direction_incoming",
};

/** Invoice statuses that may be attached to a dispute. */
const DISPUTABLE_INVOICE_STATUSES = ["Due", "Overdue"] as const;

function parseIdList(value: unknown): number[] {
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

@Injectable()
export class CustomersService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {
        // Header AR resolution reaches into the credit-insurance domain, whose FX
        // lookup reads the module-level client rather than one we pass in.
        bindCreditInsurancePrisma(this.db);
    }

    async listOrStats(user: JwtPayload, query: CustomersListQuery) {
        if (query.stats === "true") {
            return this.stats(user);
        }
        return this.list(user, query);
    }

    async list(user: JwtPayload, query: CustomersListQuery) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const search = query.search || "";
        const filter = query.filter || query.type || "All";
        const status = query.status || "";
        const sortField = query.sortField || "";
        const sortDirection = (query.sortDirection || "asc") as "asc" | "desc";
        const lastId = query.lastId ? parseInt(query.lastId, 10) : null;
        const skip = lastId ? 0 : (page - 1) * limit;

        const accessParts =
            await this.accessScope.buildCustomerAccessWhere(userInfo);

        const andClause: Record<string, unknown>[] = [
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

        let orderBy: Record<string, unknown>[] = [{ id: "asc" }];
        if (sortField) {
            const dir = sortDirection === "desc" ? "desc" : "asc";
            const map: Record<string, string> = {
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

        const queryOptions: Record<string, unknown> = {
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
        } else {
            queryOptions.skip = skip;
        }

        const [customers, totalRecords] = await Promise.all([
            this.db.customer.findMany(queryOptions as never),
            this.db.customer.count({ where: where as never }),
        ]);

        return serializeBigInt({
            customers,
            totalRecords,
            page,
            limit,
        });
    }

    async stats(user: JwtPayload) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accessParts =
            await this.accessScope.buildCustomerAccessWhere(userInfo);
        const where = { AND: accessParts };
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const [total, active, inactive, account] = await Promise.all([
            this.db.customer.count({ where: where as never }),
            this.db.customer.count({
                where: {
                    AND: [...accessParts, { collection_status: "Active" }],
                } as never,
            }),
            this.db.customer.count({
                where: {
                    AND: [...accessParts, { collection_status: "Inactive" }],
                } as never,
            }),
            this.db.account.findUnique({
                where: { id: accountId },
                select: { currency: true },
            }),
        ]);

        const customerAgg = await this.db.customer.aggregate({
            where: where as never,
            _sum: {
                total_due_amount: true,
                total_overdue_amount: true,
                no_of_due_invoices: true,
                number_of_overdue_invoices: true,
            },
        });

        const totalDue = Number(customerAgg._sum.total_due_amount ?? 0);
        const totalOverdue = Number(customerAgg._sum.total_overdue_amount ?? 0);
        const openInvoiceCount =
            Number(customerAgg._sum.no_of_due_invoices ?? 0) +
            Number(customerAgg._sum.number_of_overdue_invoices ?? 0);

        return {
            counts: {
                total_customers: total,
                active_customers: active,
                inactive_customers: inactive,
                total_due_amount: totalDue,
                total_overdue_amount: totalOverdue,
                open_invoice_count: openInvoiceCount,
                average_outstanding_per_customer:
                    total > 0 ? totalDue / total : 0,
                currency: account?.currency ?? "USD",
            },
            category_distribution: [],
        };
    }

    async getById(user: JwtPayload, id: number) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const hasViewAs = await this.accessScope.hasPermission(
            accountId,
            effectiveRole,
            "use_view_as"
        );

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
            throw new NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }
        if (exists.account_id !== accountId) {
            throw new ForbiddenException({
                error: "Access denied",
                code: "ACCESS_DENIED_ACCOUNT",
            });
        }

        if (!isAdmin && !hasViewAs) {
            const effectiveUserId =
                this.accessScope.getEffectiveUserId(userInfo);
            const hasOwnerAccess =
                !exists.owner_id || exists.owner_id === effectiveUserId;
            if (!hasOwnerAccess) {
                throw new ForbiddenException({
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
                // The Log Activity promise-to-pay picker derives its selectable
                // window and per-cycle cap from these two account settings.
                Account: {
                    select: {
                        promise_to_pay: true,
                        max_promise_to_pay_allowed_per_cycle: true,
                        currency: true,
                        has_credit_insurance: true,
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
            throw new NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }

        // The customer detail screen reads policy history from `customerPolicies`
        // and the row it edits from `activeCustomerPolicy`. Prisma names the
        // relation `CustomerPolicy`, so publish it under the keys the client
        // expects; without them the Policies tab lists nothing and the Dashboard
        // tab decides the customer has no linked policy.
        const { CustomerPolicy: customerPolicies, ...rest } = customer;

        // `total_ar` is derived, not stored: live open Due/Overdue receivables in
        // account currency, falling back to the denormalized due + overdue rollups.
        // The header's Total AR card reads it straight off this payload, so without
        // it the card renders 0 even when the customer has open invoices.
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { currency: true, has_credit_insurance: true },
        });
        const headerAr = await resolveCustomerHeaderOpenArAmounts({
            accountId,
            customerId: id,
            accountCurrency: account?.currency ?? rest.Account?.currency,
            customer,
            dbClient: this.db,
        });

        return serializeBigInt({
            ...rest,
            ...headerAr,
            Account: {
                ...rest.Account,
                currency: rest.Account?.currency ?? account?.currency ?? null,
                has_credit_insurance:
                    rest.Account?.has_credit_insurance ??
                    account?.has_credit_insurance ??
                    false,
            },
            customerPolicies,
            activeCustomerPolicy:
                customerPolicies.find((policy) => policy.is_active) ?? null,
        });
    }

    async update(user: JwtPayload, id: number, body: Record<string, unknown>) {
        await this.getById(user, id);

        if (
            body.customer_number !== undefined &&
            (body.customer_number === null ||
                String(body.customer_number).trim() === "")
        ) {
            throw new ForbiddenException({
                error: "customer_number is required",
            });
        }

        const data: Record<string, unknown> = { ...body };
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
        // Derived on GET, not columns — Prisma rejects them as unknown arguments.
        delete data.total_ar;
        delete data.total_ar_secondary;
        delete data.credit_insurance_secondary_currency;

        const updated = await this.db.customer.update({
            where: { id },
            data: data as never,
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

        return serializeBigInt(updated);
    }

    /** Resolve account scope + assert the customer belongs to it (nested-path guard). */
    private async assertCustomerInAccount(
        userInfo: AccessUserInfo,
        id: number
    ): Promise<{ accountId: number; effectiveUserId: string }> {
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const exists = await this.db.customer.findFirst({
            where: { id, account_id: accountId },
            select: { id: true },
        });
        if (!exists) {
            throw new NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }
        return {
            accountId,
            effectiveUserId: this.accessScope.getEffectiveUserId(userInfo),
        };
    }

    async listActivities(
        user: JwtPayload,
        id: number,
        query: CustomerActivityQuery
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        await this.assertCustomerInAccount(userInfo, id);

        const limit = parseInt(query.limit || "10", 10);
        const lastId = query.last_id ? parseInt(query.last_id, 10) : null;
        const filterType = query.filter_type;

        const andClause: Record<string, unknown>[] = [{ customer_id: id }];
        if (lastId) {
            andClause.push({ id: { lt: BigInt(lastId) } });
        }
        if (filterType && ACTIVITY_TYPES.includes(filterType)) {
            andClause.push({ type: filterType });
        }

        const activities = await this.db.activity.findMany({
            where: { AND: andClause } as never,
            orderBy: [{ schedule_time: "desc" }, { id: "desc" }],
            take: limit,
        });

        return serializeBigInt({
            activities: await this.hydrateActivityUsers(activities),
            totalRecords: activities.length,
        });
    }

    /**
     * Activity rows reference users by id in two places the timeline cannot
     * resolve on its own: `{{user:<uuid>}}` tokens inside `content`, and the
     * `userId`/`assigneeId` params the stored title interpolates verbatim. Both
     * otherwise render as raw uuids, so swap in display names here — one batched
     * lookup for the whole page rather than a query per row.
     */
    private async hydrateActivityUsers<
        T extends {
            title?: string | null;
            content?: string | null;
            title_params?: unknown;
            created_by?: string | null;
        },
    >(activities: T[]): Promise<T[]> {
        const ids = new Set<string>();
        const collectId = (value: unknown) => {
            const raw = optionalTrimmed(value);
            if (raw && UUID_RE.test(raw)) {
                ids.add(raw);
            }
        };

        for (const activity of activities) {
            const content = optionalTrimmed(activity.content);
            if (content) {
                for (const [, token] of content.matchAll(
                    CONTENT_USER_TOKEN_RE
                )) {
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

        const names = new Map<string, string>();
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
                const composed =
                    `${user.first_name || ""} ${user.last_name || ""}`.trim();
                const display =
                    optionalTrimmed(user.name) || optionalTrimmed(composed);
                if (display) {
                    names.set(user.id, display);
                }
            }
        }

        /**
         * Legacy rows store the display name inside the token instead of an id,
         * so anything that isn't a uuid is already presentable. `storedName` is
         * the point-in-time name recorded alongside the id and is preferred over
         * "unknown" when the user has since been deleted.
         */
        const resolveActor = (
            idValue: unknown,
            storedName: unknown
        ): string | null => {
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
                hydrated.content = String(activity.content).replace(
                    CONTENT_USER_TOKEN_RE,
                    (match, token: string) => resolveActor(token, null) ?? match
                );
            }

            const params = asParamsObject(activity.title_params);
            // Rows can carry a title whose template names an actor while having
            // no params at all, so the creator fallback has to run for those too.
            if (params || optionalTrimmed(activity.title)) {
                const next = { ...(params || {}) };
                for (const {
                    idField,
                    nameField,
                    fromCreator,
                } of ACTOR_PARAM_FIELDS) {
                    // Older rows recorded no actor param at all, which renders
                    // as a dangling "changed by"; the row's author is the same
                    // actor those titles refer to.
                    const idValue =
                        next[idField] ??
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

    async listDisputes(user: JwtPayload, id: number) {
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

        return serializeBigInt({ disputes, totalRecords: disputes.length });
    }

    async listPolicies(user: JwtPayload, id: number) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        await this.assertCustomerInAccount(userInfo, id);

        const policies = await this.db.customerPolicy.findMany({
            where: { customer_id: id },
            include: { InsurancePolicy: true },
            orderBy: { id: "desc" },
        });

        return serializeBigInt({ policies, totalRecords: policies.length });
    }

    async listTopUps(user: JwtPayload, id: number, query: CustomerTopUpsQuery) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        await this.assertCustomerInAccount(userInfo, id);

        const page = Math.max(parseInt(query.page || "1", 10) || 1, 1);
        const limit = Math.min(
            Math.max(parseInt(query.limit || "50", 10) || 50, 1),
            200
        );
        const search = (query.query || "").trim();
        const sortField = TOP_UP_SORT_FIELDS.has(query.sortField || "")
            ? (query.sortField as string)
            : "start_date";
        const sortDirection = query.sortDirection === "asc" ? "asc" : "desc";

        const where: Record<string, unknown> = { customer_id: id };
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
                where: where as never,
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
                ] as never,
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.customerTopUp.count({ where: where as never }),
        ]);

        // The grid reads `policy_number` and `insurer_name` off the row itself.
        const data = rows.map(({ InsurancePolicy, ...row }) => ({
            ...row,
            policy_number: InsurancePolicy?.policy_number ?? null,
            insurer_name: InsurancePolicy?.insurer_name ?? null,
        }));

        return serializeBigInt({ data, totalRecords, page, limit });
    }

    async createTopUp(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { accountId, effectiveUserId } =
            await this.assertCustomerInAccount(userInfo, id);

        const insurancePolicyId = Number(body.insurancePolicyId);
        if (!Number.isInteger(insurancePolicyId) || insurancePolicyId <= 0) {
            throw new BadRequestException({
                error: "insurancePolicyId is required",
            });
        }

        const topUpType =
            body.topUpType === "Percentage" ? "Percentage" : "Fixed";
        const topUpValue = Number(body.topUpValue);
        if (!Number.isFinite(topUpValue) || topUpValue <= 0) {
            throw new BadRequestException({
                error: "topUpValue must be a positive number",
            });
        }

        const currency = optionalTrimmed(body.currency);
        if (topUpType === "Fixed" && !currency) {
            throw new BadRequestException({
                error: "currency is required for a fixed top-up",
            });
        }

        const startDate = parseDateOnly(body.startDate);
        const endDate = parseDateOnly(body.endDate);
        if (!startDate) {
            throw new BadRequestException({ error: "startDate is required" });
        }
        if (!endDate) {
            throw new BadRequestException({ error: "endDate is required" });
        }
        if (endDate < startDate) {
            // The add-top-up dialog matches on this text to flag the end date field.
            throw new BadRequestException({
                error: "endDate must be on or after startDate",
            });
        }

        let premium: number | null = null;
        if (body.premium != null && body.premium !== "") {
            premium = Number(body.premium);
            if (!Number.isFinite(premium) || premium < 0) {
                throw new BadRequestException({
                    error: "premium must be a positive number",
                });
            }
        }
        const premiumCurrency = optionalTrimmed(body.premiumCurrency);
        if (premium != null && !premiumCurrency) {
            throw new BadRequestException({
                error: "premiumCurrency is required when a premium is set",
            });
        }

        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: insurancePolicyId, account_id: accountId },
            select: { id: true, policy_kind: true },
        });
        if (!policy) {
            throw new NotFoundException({
                error: "Insurance policy not found",
            });
        }
        if (policy.policy_kind !== "TopUp") {
            throw new BadRequestException({
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
            } as never,
        });
        await enqueueAsOfRewrite({
            accountId,
            customerIds: [id],
            fromDate: startDate,
            toDate: new Date(),
        });

        return serializeBigInt(topUp);
    }

    /**
     * Cancels rather than deletes: the grid keeps cancelled rows and badges
     * them, and cost calculations still need the historical coverage window.
     */
    async cancelTopUp(user: JwtPayload, id: number, topUpId: number) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { accountId, effectiveUserId } = await this.assertCustomerInAccount(
            userInfo,
            id
        );

        const topUp = await this.db.customerTopUp.findFirst({
            where: { id: topUpId, customer_id: id },
            select: { id: true, cancelled_at: true },
        });
        if (!topUp) {
            throw new NotFoundException({ error: "Top-up not found" });
        }
        if (topUp.cancelled_at) {
            return serializeBigInt(topUp);
        }

        const cancelled = await this.db.customerTopUp.update({
            where: { id: topUpId },
            data: {
                cancelled_at: new Date(),
                modified_by: effectiveUserId,
            } as never,
        });
        await enqueueAsOfRewrite({
            accountId,
            customerIds: [id],
            fromDate: cancelled.start_date,
            toDate: new Date(),
        });

        return serializeBigInt(cancelled);
    }

    async stuckActivities(user: JwtPayload, id: number) {
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

    /** Display name for activity title_params, so the timeline never shows a raw user id. */
    private async actingUserName(userId: string): Promise<string | null> {
        const user = await this.db.user.findFirst({
            where: { id: userId },
            select: { name: true, first_name: true, last_name: true },
        });
        if (!user) {
            return null;
        }
        const composed =
            `${user.first_name || ""} ${user.last_name || ""}`.trim();
        return optionalTrimmed(user.name) || optionalTrimmed(composed);
    }

    /** Open collection period a logged call and its side effects attach to. */
    private async openCollectionPeriod(customerId: number) {
        return this.db.customerCollectionPeriod.findFirst({
            where: { customer_id: customerId, period_end_date: null },
            select: { id: true, promise_to_pay_count: true },
            orderBy: { id: "desc" },
        });
    }

    async invoicesAvailableForDispute(user: JwtPayload, id: number) {
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

        return serializeBigInt({
            invoices,
            totalRecords: invoices.length,
        });
    }

    async logCallActivity(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { accountId, effectiveUserId } =
            await this.assertCustomerInAccount(userInfo, id);

        const callOutcome = body.call_outcome as string | undefined;
        if (!callOutcome) {
            throw new BadRequestException({
                error: "Call outcome is required",
            });
        }
        if (!CALL_OUTCOME_TITLE_KEYS[callOutcome]) {
            throw new BadRequestException({
                error: `Unsupported call outcome: ${callOutcome}`,
            });
        }

        const contactInput = (body.contact || null) as {
            id?: unknown;
            name?: unknown;
        } | null;
        const contactId = contactInput?.id
            ? parseInt(String(contactInput.id), 10)
            : NaN;
        let contact: { id: number; name: string } | null = null;
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
                throw new BadRequestException({
                    error: "Contact does not belong to this customer",
                });
            }
            contact = {
                id: found.id,
                name:
                    optionalTrimmed(found.full_name) ||
                    `${found.first_name || ""} ${found.last_name || ""}`.trim(),
            };
        }

        const followUpTime = optionalTrimmed(body.follow_up_time);
        if (callOutcome === "schedule_follow_up" && !followUpTime) {
            throw new BadRequestException({
                error: "Follow-up time is required to schedule a follow-up",
            });
        }

        const promiseDate =
            callOutcome === "promise_to_pay"
                ? parseDateOnly(body.follow_up_time)
                : null;
        if (callOutcome === "promise_to_pay" && !promiseDate) {
            throw new BadRequestException({
                error: "A valid payment date (YYYY-MM-DD) is required for a promise to pay",
            });
        }

        const disputeInvoiceIds = parseIdList(body.disputed_invoices);
        const disputeReasonId = body.dispute_reason
            ? parseInt(String(body.dispute_reason), 10)
            : NaN;
        let disputeInvoices: { id: number; invoice_number: string | null }[] =
            [];
        if (callOutcome === "open_dispute") {
            if (disputeInvoiceIds.length === 0) {
                throw new BadRequestException({
                    error: "At least one invoice is required to open a dispute",
                });
            }
            if (!Number.isFinite(disputeReasonId)) {
                throw new BadRequestException({
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
                throw new BadRequestException({
                    error: "One or more invoices do not belong to this customer",
                });
            }
        }

        const collectionPeriod = await this.openCollectionPeriod(id);
        const userName = await this.actingUserName(effectiveUserId);
        const now = new Date();

        const titleParams: Record<string, unknown> = {
            userId: effectiveUserId,
            ...(userName ? { userName } : {}),
        };
        if (contact) {
            titleParams.contact = contact.name;
        }
        if (callOutcome === "schedule_follow_up") {
            titleParams.time = followUpTime;
        }
        if (
            callOutcome === "general" ||
            callOutcome === "promise_to_pay" ||
            callOutcome === "open_dispute"
        ) {
            titleParams.outcome = CALL_OUTCOME_LABEL_KEYS[callOutcome];
            const direction = optionalTrimmed(body.call_direction);
            titleParams.callType = direction
                ? (CALL_DIRECTION_LABEL_KEYS[direction.toLowerCase()] ??
                  direction)
                : CALL_OUTCOME_LABEL_KEYS.general;
        }

        // The dialog's timer sends elapsed seconds, but Activity has no duration
        // column. Keeping it in title_params is the only lossless place for it
        // without a migration, so the recorded time is not simply thrown away.
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
                    content: (body.notes as string) || "",
                    call_outcome: callOutcome,
                    contact_id: contact?.id ?? null,
                    collection_period_id: collectionPeriod?.id ?? null,
                    schedule_time: now,
                    actual_delivery_time: now,
                    created_by: effectiveUserId,
                } as never,
            });

            if (contact) {
                await tx.activityContact.create({
                    data: {
                        activity_id: activity.id,
                        contact_id: contact.id,
                        communication_channel: "Call",
                        sent_at: now,
                        created_by: effectiveUserId,
                    } as never,
                });
            }

            let dispute: { id: number } | null = null;
            if (callOutcome === "open_dispute") {
                dispute = await tx.customerDispute.create({
                    data: {
                        customer_id: id,
                        dispute_reason_id: disputeReasonId,
                        dispute_status: "Under_Review",
                        customer_comment: (body.notes as string) || "",
                        customer_collection_period_id:
                            collectionPeriod?.id ?? null,
                        invoices_in_dispute: disputeInvoices
                            .map((inv) => inv.invoice_number)
                            .filter(Boolean)
                            .join(","),
                        owner_id: effectiveUserId,
                        created_by: effectiveUserId,
                    } as never,
                    select: { id: true },
                });
                await tx.disputeInvoice.createMany({
                    data: disputeInvoices.map((inv) => ({
                        dispute_id: dispute!.id,
                        invoice_id: inv.id,
                        created_by: effectiveUserId,
                    })) as never,
                });
                const reason = await tx.disputeReason.findFirst({
                    where: { id: disputeReasonId },
                    select: { name: true },
                });
                // Separate Dispute-type activity so the dispute shows on the
                // timeline with a gavel badge, matching the pre-migration feed.
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
                        content: (body.notes as string) || "",
                        contact_id: contact?.id ?? null,
                        collection_period_id: collectionPeriod?.id ?? null,
                        schedule_time: now,
                        actual_delivery_time: now,
                        created_by: effectiveUserId,
                    } as never,
                });
            }

            if (collectionPeriod) {
                const periodUpdate: Record<string, unknown> = {
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
                    data: periodUpdate as never,
                });
            }

            return { activity, disputeId: dispute?.id ?? null };
        });

        return serializeBigInt({
            ok: true,
            activity: result.activity,
            disputeId: result.disputeId,
            promiseToPayDate: promiseDate,
            durationSeconds: Number.isFinite(duration) ? duration : null,
        });
    }

    async sendEmailActivity(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const { accountId, effectiveUserId } =
            await this.assertCustomerInAccount(userInfo, id);

        const contactIds = body.contactIds as unknown[] | undefined;
        const subject = body.subject as string | undefined;
        const emailBody = body.emailBody as string | undefined;

        if (
            !contactIds ||
            !Array.isArray(contactIds) ||
            contactIds.length === 0
        ) {
            throw new BadRequestException({
                error: "At least one contact is required",
            });
        }
        if (!subject || !subject.trim()) {
            throw new BadRequestException({
                error: "Email subject is required",
            });
        }
        if (!emailBody || !emailBody.trim()) {
            throw new BadRequestException({ error: "Email body is required" });
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
            } as never,
        });

        return serializeBigInt({
            ok: true,
            activity: serializeBigInt(activity),
        });
    }

    async updateDispute(
        user: JwtPayload,
        id: number,
        disputeId: number,
        op: string,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        await this.assertCustomerInAccount(userInfo, id);

        const dispute = await this.db.customerDispute.findFirst({
            where: { id: disputeId, customer_id: id },
        });
        if (!dispute) {
            throw new NotFoundException({ error: "Dispute not found" });
        }

        const data: Record<string, unknown> = {};
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
            data: data as never,
        });

        return serializeBigInt(updated);
    }

    async searchCustomers(
        user: JwtPayload,
        opts: { q?: string; excludeId?: number }
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accessParts =
            await this.accessScope.buildCustomerAccessWhere(userInfo);
        const q = (opts.q || "").trim();
        const andClause: Record<string, unknown>[] = [...accessParts];
        if (opts.excludeId != null && Number.isFinite(opts.excludeId)) {
            andClause.push({ id: { not: opts.excludeId } });
        }
        if (q) {
            andClause.push({
                OR: [
                    {
                        customer_number: {
                            contains: q,
                            mode: "insensitive",
                        },
                    },
                    {
                        Person: {
                            OR: [
                                {
                                    first_name: {
                                        contains: q,
                                        mode: "insensitive",
                                    },
                                },
                                {
                                    last_name: {
                                        contains: q,
                                        mode: "insensitive",
                                    },
                                },
                                {
                                    full_name: {
                                        contains: q,
                                        mode: "insensitive",
                                    },
                                },
                            ],
                        },
                    },
                    {
                        Company: {
                            name: { contains: q, mode: "insensitive" },
                        },
                    },
                ],
            });
        }

        const rows = await this.db.customer.findMany({
            where: { AND: andClause },
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
            orderBy: [{ customer_number: "asc" }, { id: "asc" }],
            take: 50,
        });

        const items = rows.map((customer) => ({
            id: customer.id,
            customer_number: customer.customer_number,
            type: customer.type,
            name:
                customer.type === "Person"
                    ? customer.Person?.full_name ||
                      `${customer.Person?.first_name || ""} ${customer.Person?.last_name || ""}`.trim()
                    : customer.Company?.name || "",
        }));

        return serializeBigInt({ items });
    }

    async validateBusinessUnitAccess(
        user: JwtPayload,
        customerNumbers: Array<string | number>
    ) {
        if (!Array.isArray(customerNumbers)) {
            throw new BadRequestException({
                error: "customerNumbers must be an array",
            });
        }

        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const isAdmin =
            this.accessScope.isAdminAccount(userInfo.accountId) ||
            role === "archaser_admin" ||
            role === "ARchaser Admin" ||
            role === "Admin";

        const numbers = customerNumbers.map((n) => String(n));
        const customers = await this.db.customer.findMany({
            where: {
                customer_number: { in: numbers },
                account_id: accountId,
            },
            select: {
                customer_number: true,
                business_unit_id: true,
            },
        });

        let accessibleBuIds: number[] | null = null;
        if (!isAdmin) {
            const userBuId = userInfo.businessUnitId ?? null;
            if (userBuId == null) {
                accessibleBuIds = [];
            } else {
                const descendants =
                    await this.accessScope.getBusinessUnitHierarchy(userBuId);
                accessibleBuIds = [userBuId, ...descendants];
            }
        }

        const items: Array<{
            customerNumber: string;
            hasAccess: boolean;
            businessUnitId: number | null;
            businessUnitExternalId: string | null;
        }> = [];

        for (const customer of customers) {
            let hasAccess = true;
            let businessUnitExternalId: string | null = null;
            if (customer.business_unit_id != null) {
                if (
                    accessibleBuIds !== null &&
                    !accessibleBuIds.includes(customer.business_unit_id)
                ) {
                    hasAccess = false;
                }
                const bu = await this.db.businessUnit.findUnique({
                    where: { id: customer.business_unit_id },
                    select: { external_id: true },
                });
                businessUnitExternalId = bu?.external_id ?? null;
            }
            items.push({
                customerNumber: String(customer.customer_number),
                hasAccess,
                businessUnitId: customer.business_unit_id,
                businessUnitExternalId,
            });
        }

        const found = new Set(customers.map((c) => String(c.customer_number)));
        for (const customerNumber of numbers) {
            if (!found.has(customerNumber)) {
                items.push({
                    customerNumber,
                    hasAccess: true,
                    businessUnitId: null,
                    businessUnitExternalId: null,
                });
            }
        }

        return { items };
    }

    async addComment(
        user: JwtPayload,
        customerId: number,
        comment: string
    ) {
        const trimmed = (comment || "").trim();
        if (!trimmed) {
            throw new BadRequestException({ error: "comment is required" });
        }

        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: { id: true },
        });
        if (!customer) {
            throw new NotFoundException({ error: "Customer not found" });
        }

        const period = await this.db.customerCollectionPeriod.findFirst({
            where: {
                customer_id: customerId,
                period_end_date: null,
            },
            select: { id: true },
            orderBy: { id: "desc" },
        });

        const created = await this.db.activity.create({
            data: {
                customer_id: customerId,
                account_id: accountId,
                type: "Internal",
                status: "Completed",
                title: "Comment",
                content: trimmed,
                schedule_time: new Date(),
                collection_period_id: period?.id ?? null,
                created_by: userInfo.userId,
                modified_by: userInfo.userId,
                system_generated: false,
            } as never,
        });

        return serializeBigInt(created);
    }

    async getAggregatedData(user: JwtPayload, customerId: number) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: {
                id: true,
                total_due_amount: true,
                total_overdue_amount: true,
                no_of_due_invoices: true,
                number_of_overdue_invoices: true,
            },
        });
        if (!customer) {
            throw new NotFoundException({ error: "Customer not found" });
        }
        const childCount = await this.db.customer.count({
            where: { parent_customer_id: customerId },
        });
        if (childCount === 0) {
            throw new NotFoundException({
                error: "Customer has no child customers",
                code: "NO_CHILD_CUSTOMERS",
            });
        }
        const children = await this.db.customer.aggregate({
            where: { parent_customer_id: customerId, account_id: accountId },
            _sum: {
                total_due_amount: true,
                total_overdue_amount: true,
                no_of_due_invoices: true,
                number_of_overdue_invoices: true,
            },
            _count: { _all: true },
        });
        return serializeBigInt({
            customerId,
            childCount: children._count._all,
            totalDueAmount: children._sum.total_due_amount ?? 0,
            totalOverdueAmount: children._sum.total_overdue_amount ?? 0,
            dueInvoiceCount: children._sum.no_of_due_invoices ?? 0,
            overdueInvoiceCount: children._sum.number_of_overdue_invoices ?? 0,
        });
    }
}
