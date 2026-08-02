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
exports.SystemService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const financial_dashboard_builder_1 = require("./financial-dashboard.builder");
const COLLECTION_ROLES = [
    "Collection_Agent",
    "Collection_Manager",
];
const OPEN_INVOICE_STATUSES = [
    "Due",
    "Open",
    "Partially_Paid",
    "Overdue",
];
const LINKED_PAYMENT = { invoice_id: { gt: 0 } };
const AGING_BUCKETS = [
    { daysRange: "0_7", min: 0, max: 7 },
    { daysRange: "8_30", min: 8, max: 30 },
    { daysRange: "31_60", min: 31, max: 60 },
    { daysRange: "61_90", min: 61, max: 90 },
    { daysRange: "91_180", min: 91, max: 180 },
    { daysRange: "181_365", min: 181, max: 365 },
    { daysRange: "365_2000", min: 366, max: 9999 },
];
const UNPAID_INVOICE_STATUSES = [
    "Open",
    "Overdue",
    "Partially_Paid",
    "Under_Dispute",
    "Due",
    "Draft",
    "Sent",
    "Viewed",
];
let SystemService = class SystemService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async scope(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        return { userInfo, accountId };
    }
    startOfUtcDay(d) {
        const x = new Date(d);
        x.setUTCHours(0, 0, 0, 0);
        return x;
    }
    endOfUtcDay(d) {
        const x = new Date(d);
        x.setUTCHours(23, 59, 59, 999);
        return x;
    }
    addDays(d, days) {
        const x = new Date(d);
        x.setUTCDate(x.getUTCDate() + days);
        return x;
    }
    async accountCurrency(accountId) {
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { currency: true },
        });
        return account?.currency || "USD";
    }
    async sumOutstanding(accountId, extra = {}) {
        const where = {
            account_id: accountId,
            status: { in: [...OPEN_INVOICE_STATUSES] },
            ...extra,
        };
        const [agg, count] = await Promise.all([
            this.db.invoice.aggregate({
                where,
                _sum: { outstanding_debt: true },
            }),
            this.db.invoice.count({ where }),
        ]);
        return {
            amount: Number(agg._sum.outstanding_debt ?? 0),
            count,
        };
    }
    dashboardCacheKey(accountId, viewMode, businessUnitId, ownerId) {
        return `${accountId}_${businessUnitId || "all"}_${ownerId || "all"}_${viewMode}`;
    }
    async tryDashboardCache(accountId, viewMode, query) {
        if (query.bypassCache === "true" || query.invalidateCache === "true") {
            return null;
        }
        const cacheKey = this.dashboardCacheKey(accountId, viewMode, query.businessUnitId, query.ownerId);
        try {
            const cached = await this.db.dashboardCache.findUnique({
                where: { cache_key: cacheKey },
            });
            if (!cached) {
                return null;
            }
            const chart = cached.chart_data;
            const hasCharts = Boolean(chart?.audienceReport?.series
                ?.length) ||
                Boolean(chart?.collectionEffortsPhase?.series?.length) ||
                (Array.isArray(cached.collection_stats) &&
                    cached.collection_stats.length > 0);
            if (!hasCharts && cached.expires_at < new Date()) {
                return null;
            }
            return (0, financial_dashboard_builder_1.reconstructDashboardFromCache)({
                ...cached,
                chart_data: cached.chart_data &&
                    typeof cached.chart_data === "object" &&
                    !Array.isArray(cached.chart_data)
                    ? cached.chart_data
                    : null,
            });
        }
        catch {
            return null;
        }
    }
    async buildCollectedVsPromiseSeries(accountId) {
        const now = new Date();
        const collectedData = [];
        const promiseToPayData = [];
        for (let i = 5; i >= 0; i--) {
            const target = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthStart = new Date(target.getFullYear(), target.getMonth(), 1);
            const monthEnd = new Date(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59, 999);
            const [collected, promise] = await Promise.all([
                this.db.invoicePayment.aggregate({
                    where: {
                        account_id: accountId,
                        payment_date: { gte: monthStart, lte: monthEnd },
                        ...LINKED_PAYMENT,
                    },
                    _sum: { amount: true },
                }),
                this.db.customerCollectionPeriod.aggregate({
                    where: {
                        Customer: { account_id: accountId },
                        promise_to_pay_date: {
                            gte: monthStart,
                            lte: monthEnd,
                        },
                        promise_to_pay_amount: { not: null },
                    },
                    _sum: { promise_to_pay_amount: true },
                }),
            ]);
            collectedData.push(Math.round(Number(collected._sum.amount ?? 0)));
            promiseToPayData.push(Math.round(Number(promise._sum.promise_to_pay_amount ?? 0)));
        }
        return (0, financial_dashboard_builder_1.buildAudienceReportChart)(collectedData, promiseToPayData, now);
    }
    async buildCategoryWidgets(accountId, currency) {
        const categories = [
            "Automated",
            "Agent",
            "Promise_to_pay",
            "Dispute",
            "Legal",
        ];
        const periodGroups = await this.db.customerCollectionPeriod.groupBy({
            by: ["current_category"],
            where: {
                period_end_date: null,
                Customer: {
                    account_id: accountId,
                    collection_status: "Active",
                },
                current_category: { in: [...categories] },
            },
            _count: { _all: true },
            _sum: {
                total_outstanding_amount: true,
                no_of_overdue_invoices: true,
                promise_to_pay_amount: true,
            },
        });
        const byCat = new Map(periodGroups.map((g) => [g.current_category, g]));
        const counts = {
            Automated: byCat.get("Automated")?._count._all || 0,
            Agent: byCat.get("Agent")?._count._all || 0,
            Promise_to_pay: byCat.get("Promise_to_pay")?._count._all || 0,
            Dispute: byCat.get("Dispute")?._count._all || 0,
            Legal: byCat.get("Legal")?._count._all || 0,
        };
        const collectionEffortsPhase = (0, financial_dashboard_builder_1.buildCollectionEffortsPhase)(counts);
        const collectionStats = [
            (0, financial_dashboard_builder_1.buildCollectionStat)("In Dispute", counts.Dispute, Number(byCat.get("Dispute")?._sum.no_of_overdue_invoices ?? 0), Number(byCat.get("Dispute")?._sum.total_outstanding_amount ?? 0), currency),
            (0, financial_dashboard_builder_1.buildCollectionStat)("Promise to Pay", counts.Promise_to_pay, Number(byCat.get("Promise_to_pay")?._sum.no_of_overdue_invoices ?? 0), Number(byCat.get("Promise_to_pay")?._sum.promise_to_pay_amount ??
                byCat.get("Promise_to_pay")?._sum
                    .total_outstanding_amount ??
                0), currency),
            (0, financial_dashboard_builder_1.buildCollectionStat)("Automated", counts.Automated, Number(byCat.get("Automated")?._sum.no_of_overdue_invoices ?? 0), Number(byCat.get("Automated")?._sum.total_outstanding_amount ?? 0), currency),
            (0, financial_dashboard_builder_1.buildCollectionStat)("Agent", counts.Agent, Number(byCat.get("Agent")?._sum.no_of_overdue_invoices ?? 0), Number(byCat.get("Agent")?._sum.total_outstanding_amount ?? 0), currency),
        ];
        return { collectionEffortsPhase, collectionStats };
    }
    async buildAgingPortfolio(accountId) {
        const today = this.startOfUtcDay(new Date());
        const ranges = AGING_BUCKETS;
        const overdueInvoices = await this.db.invoice.findMany({
            where: {
                account_id: accountId,
                status: "Overdue",
                due_date: { lt: today },
                customer_id: { not: null },
            },
            select: {
                customer_id: true,
                outstanding_debt: true,
                due_date: true,
            },
            take: 20000,
        });
        const buckets = ranges.map((r) => {
            const inRange = overdueInvoices.filter((inv) => {
                if (!inv.due_date) {
                    return false;
                }
                const days = Math.floor((today.getTime() - inv.due_date.getTime()) /
                    (1000 * 60 * 60 * 24));
                return days >= r.min && days <= r.max;
            });
            const customers = new Set(inRange
                .map((i) => i.customer_id)
                .filter((id) => id != null));
            const amount = inRange.reduce((s, i) => s + Number(i.outstanding_debt ?? 0), 0);
            return {
                daysRange: r.daysRange,
                invoices: inRange.length,
                accounts: customers.size,
                amount,
            };
        });
        return {
            chartData: (0, financial_dashboard_builder_1.buildAgingRangeRows)(buckets),
            details: [],
        };
    }
    async buildEntityBreakdowns(accountId, invoiceWhere) {
        const groups = await this.db.invoice.groupBy({
            by: ["customer_id"],
            where: {
                ...invoiceWhere,
                account_id: accountId,
                customer_id: { not: null },
            },
            _sum: { outstanding_debt: true },
        });
        const customerIds = groups
            .map((group) => group.customer_id)
            .filter((id) => id != null);
        if (customerIds.length === 0) {
            return { byCustomer: [], byBusinessUnit: [] };
        }
        const customers = await this.db.customer.findMany({
            where: { id: { in: customerIds } },
            select: {
                id: true,
                Person: { select: { full_name: true } },
                Company: { select: { name: true } },
                BusinessUnit: { select: { id: true, name: true } },
            },
        });
        const byId = new Map(customers.map((customer) => [customer.id, customer]));
        const customerEntries = [];
        const unitTotals = new Map();
        for (const group of groups) {
            const amount = Number(group._sum?.outstanding_debt ?? 0);
            if (group.customer_id == null || amount <= 0) {
                continue;
            }
            const customer = byId.get(group.customer_id);
            customerEntries.push({
                label: customer?.Person?.full_name ||
                    customer?.Company?.name ||
                    `#${group.customer_id}`,
                amount,
            });
            const unit = customer?.BusinessUnit;
            if (!unit) {
                continue;
            }
            const existing = unitTotals.get(unit.id);
            if (existing) {
                existing.amount += amount;
            }
            else {
                unitTotals.set(unit.id, {
                    label: unit.name || `#${unit.id}`,
                    amount,
                });
            }
        }
        return {
            byCustomer: (0, financial_dashboard_builder_1.buildTopEntityAmounts)(customerEntries),
            byBusinessUnit: (0, financial_dashboard_builder_1.buildTopEntityAmounts)([...unitTotals.values()]),
        };
    }
    async buildReceivablesMaturitySchedule(accountId) {
        const today = this.startOfUtcDay(new Date());
        const upcoming = await this.db.invoice.findMany({
            where: {
                account_id: accountId,
                status: { in: [...OPEN_INVOICE_STATUSES] },
                due_date: { gte: today },
                customer_id: { not: null },
            },
            select: {
                customer_id: true,
                outstanding_debt: true,
                due_date: true,
            },
            take: 20000,
        });
        const buckets = AGING_BUCKETS.map((range) => {
            const inRange = upcoming.filter((invoice) => {
                if (!invoice.due_date) {
                    return false;
                }
                const days = Math.floor((invoice.due_date.getTime() - today.getTime()) /
                    (1000 * 60 * 60 * 24));
                return days >= range.min && days <= range.max;
            });
            const customers = new Set(inRange
                .map((invoice) => invoice.customer_id)
                .filter((id) => id != null));
            return {
                daysRange: range.daysRange,
                invoices: inRange.length,
                accounts: customers.size,
                amount: inRange.reduce((sum, invoice) => sum + Number(invoice.outstanding_debt ?? 0), 0),
            };
        });
        return (0, financial_dashboard_builder_1.buildMaturityRows)(buckets);
    }
    async buildActiveCustomersSeries(accountId) {
        const now = new Date();
        const added = [];
        const removed = [];
        for (let i = 5; i >= 0; i--) {
            const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
            const window = { gte: monthStart, lte: monthEnd };
            const [addedCount, removedCount] = await Promise.all([
                this.db.customer.count({
                    where: {
                        account_id: accountId,
                        collection_status: "Active",
                        created_at: window,
                    },
                }),
                this.db.customer.count({
                    where: {
                        account_id: accountId,
                        collection_status: "Inactive",
                        modified_at: window,
                    },
                }),
            ]);
            added.push(addedCount);
            removed.push(removedCount);
        }
        return (0, financial_dashboard_builder_1.buildActiveCustomersChart)(added, removed, now);
    }
    async buildAutomatedPhaseSplit(accountId) {
        const groups = await this.db.customerCollectionPeriod.groupBy({
            by: ["last_automated_step"],
            where: {
                period_end_date: null,
                current_category: "Automated",
                Customer: {
                    account_id: accountId,
                    collection_status: "Active",
                },
            },
            _count: { _all: true },
            _sum: { no_of_overdue_invoices: true },
        });
        const steps = groups
            .map((group) => ({
            step: group.last_automated_step ?? 0,
            customers: group._count?._all ?? 0,
            invoices: Number(group._sum?.no_of_overdue_invoices ?? 0),
        }))
            .sort((a, b) => a.step - b.step)
            .map((entry) => ({
            label: `Step ${entry.step}`,
            customers: entry.customers,
            invoices: entry.invoices,
        }));
        return (0, financial_dashboard_builder_1.buildAutomatedPhaseSplitChart)(steps);
    }
    async getDashboard(user, query = {}) {
        const { accountId } = await this.scope(user);
        const viewMode = query.viewMode === "parent" || query.viewMode === "child"
            ? query.viewMode
            : "child";
        const cached = await this.tryDashboardCache(accountId, viewMode, query);
        if (cached) {
            return (0, serialize_bigint_1.serializeBigInt)(cached);
        }
        const currency = await this.accountCurrency(accountId);
        const today = this.startOfUtcDay(new Date());
        const endToday = this.endOfUtcDay(today);
        const endWeek = this.endOfUtcDay(this.addDays(today, 7));
        const endMonth = this.endOfUtcDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)));
        const startNextMonth = this.startOfUtcDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)));
        const endNextMonth = this.endOfUtcDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0)));
        const monthStart = new Date(today.getUTCFullYear(), today.getUTCMonth(), 1);
        const monthEnd = new Date(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 23, 59, 59, 999);
        const overdueWhere = {
            account_id: accountId,
            status: "Overdue",
        };
        const [overdueAgg, overdueInvoices, overdueCustomerGroups, collectedMtdAgg, totalDue, dueToday, dueThisWeek, dueThisMonth, dueNextMonth, disputeClosed, disputeInvoiceCount, disputeAmountAgg, uniqueDisputeCustomers, childBuCount, audienceReport, categoryWidgets, agingPortfolio, overdueByEntity, dueByEntity, receivablesMaturitySchedule, activeCustomersChart, automatedPhaseSplit,] = await Promise.all([
            this.db.invoice.aggregate({
                where: overdueWhere,
                _sum: { outstanding_debt: true },
            }),
            this.db.invoice.count({ where: overdueWhere }),
            this.db.invoice.groupBy({
                by: ["customer_id"],
                where: {
                    ...overdueWhere,
                    customer_id: { not: null },
                },
            }),
            this.db.invoicePayment.aggregate({
                where: {
                    account_id: accountId,
                    payment_date: { gte: monthStart, lte: monthEnd },
                    ...LINKED_PAYMENT,
                },
                _sum: { amount: true },
            }),
            this.sumOutstanding(accountId),
            this.sumOutstanding(accountId, {
                due_date: { gte: today, lte: endToday },
            }),
            this.sumOutstanding(accountId, {
                due_date: { gte: today, lte: endWeek },
            }),
            this.sumOutstanding(accountId, {
                due_date: { gte: today, lte: endMonth },
            }),
            this.sumOutstanding(accountId, {
                due_date: { gte: startNextMonth, lte: endNextMonth },
            }),
            this.db.customerDispute.count({
                where: {
                    Customer: { account_id: accountId },
                    dispute_status: { in: ["Resolved", "Cancelled"] },
                },
            }),
            this.db.disputeInvoice.count({
                where: {
                    CustomerDispute: {
                        Customer: { account_id: accountId },
                        dispute_status: {
                            notIn: ["Resolved", "Cancelled"],
                        },
                    },
                },
            }),
            this.db.invoice.aggregate({
                where: {
                    account_id: accountId,
                    status: "Under_Dispute",
                },
                _sum: { outstanding_debt: true },
            }),
            this.db.customerDispute.groupBy({
                by: ["customer_id"],
                where: {
                    Customer: { account_id: accountId },
                    dispute_status: {
                        notIn: ["Resolved", "Cancelled"],
                    },
                },
            }),
            this.db.businessUnit.count({
                where: {
                    account_id: accountId,
                    parent_id: { not: null },
                },
            }),
            this.buildCollectedVsPromiseSeries(accountId),
            this.buildCategoryWidgets(accountId, currency),
            this.buildAgingPortfolio(accountId),
            this.buildEntityBreakdowns(accountId, { status: "Overdue" }),
            this.buildEntityBreakdowns(accountId, {
                status: { in: [...OPEN_INVOICE_STATUSES] },
                due_date: { gte: today },
            }),
            this.buildReceivablesMaturitySchedule(accountId),
            this.buildActiveCustomersSeries(accountId),
            this.buildAutomatedPhaseSplit(accountId),
        ]);
        const response = {
            activeCustomers: overdueCustomerGroups.length,
            overdueAmount: Number(overdueAgg._sum.outstanding_debt ?? 0),
            overdueInvoices,
            totalCollected: Number(collectedMtdAgg._sum.amount ?? 0),
            totalDue: totalDue.amount,
            dueToday: dueToday.amount,
            dueThisWeek: dueThisWeek.amount,
            dueThisMonth: dueThisMonth.amount,
            dueNextMonth: dueNextMonth.amount,
            currency,
            collectionStats: categoryWidgets.collectionStats,
            categoryStats: [],
            disputeStats: {
                totalDisputeAmount: Number(disputeAmountAgg._sum.outstanding_debt ?? 0),
                uniqueCustomerCount: uniqueDisputeCustomers.length,
                disputeInvoiceCount,
                totalClosed: disputeClosed,
            },
            audienceReport,
            agingPortfolio,
            collectionEffortsPhase: categoryWidgets.collectionEffortsPhase,
            automatedPhaseSplit,
            activeCustomersChart,
            receivablesMaturitySchedule,
            invoicesByCustomer: dueByEntity.byCustomer,
            invoicesByBusinessUnit: dueByEntity.byBusinessUnit,
            overdueInvoicesByCustomer: overdueByEntity.byCustomer,
            overdueInvoicesByBusinessUnit: overdueByEntity.byBusinessUnit,
            lastSynced: new Date().toISOString(),
            viewMode,
            hasChildBusinessUnits: childBuCount > 0,
            fromCache: false,
        };
        return (0, serialize_bigint_1.serializeBigInt)(response);
    }
    openCollectionPeriodFilter() {
        return {
            period_end_date: null,
            total_outstanding_amount: { gt: 0 },
        };
    }
    async selectedBusinessUnitFilter(query) {
        const selected = query.businessUnitId
            ? parseInt(String(query.businessUnitId), 10)
            : NaN;
        if (!Number.isFinite(selected) || selected <= 0) {
            return null;
        }
        const ids = [
            selected,
            ...(await this.accessScope.getBusinessUnitHierarchy(selected)),
        ];
        return { business_unit_id: { in: ids } };
    }
    resolveAgingBucket(daysRange) {
        if (!daysRange) {
            return null;
        }
        const normalized = daysRange
            .trim()
            .replace(/-/g, "_")
            .replace(/\+$/, "");
        return (AGING_BUCKETS.find((b) => b.daysRange === normalized) ??
            AGING_BUCKETS.find((b) => b.daysRange.startsWith(`${normalized}_`)) ??
            null);
    }
    async getChartDetails(user, query = {}) {
        const { userInfo, accountId } = await this.scope(user);
        if (query.type === "aging-portfolio") {
            const bucket = this.resolveAgingBucket(query.daysRange);
            const today = this.startOfUtcDay(new Date());
            const customerScope = [
                ...(await this.accessScope.buildCustomerAccessWhere(userInfo)),
                { collection_status: "Active" },
            ];
            const selectedBu = await this.selectedBusinessUnitFilter(query);
            if (selectedBu) {
                customerScope.push(selectedBu);
            }
            const where = {
                account_id: accountId,
                status: { in: [...UNPAID_INVOICE_STATUSES] },
                Customer: { AND: customerScope },
                due_date: bucket
                    ? {
                        gte: this.startOfUtcDay(this.addDays(today, -bucket.max)),
                        lte: this.endOfUtcDay(this.addDays(today, -bucket.min)),
                    }
                    : { lt: today },
            };
            const [totalRecords, amountAgg, currency] = await Promise.all([
                this.db.invoice.count({ where }),
                this.db.invoice.aggregate({
                    where,
                    _sum: { outstanding_debt: true },
                }),
                this.accountCurrency(accountId),
            ]);
            return (0, serialize_bigint_1.serializeBigInt)({
                details: [],
                data: [],
                totalRecords,
                summary: {
                    totalRecords,
                    totalAmount: Number(amountAgg._sum.outstanding_debt ?? 0),
                },
                currency,
            });
        }
        if (query.type === "overdue-amount" ||
            query.type === "overdue-customers") {
            const periodFilter = this.openCollectionPeriodFilter();
            const customerScope = [
                ...(await this.accessScope.buildCustomerAccessWhere(userInfo)),
            ];
            const selectedBu = await this.selectedBusinessUnitFilter(query);
            if (selectedBu) {
                customerScope.push(selectedBu);
            }
            const [totalRecords, amountAgg, currency] = await Promise.all([
                this.db.customer.count({
                    where: {
                        AND: [
                            ...customerScope,
                            { CustomerCollectionPeriod: { some: periodFilter } },
                        ],
                    },
                }),
                this.db.customerCollectionPeriod.aggregate({
                    where: {
                        ...periodFilter,
                        Customer: { AND: customerScope },
                    },
                    _sum: { total_outstanding_amount: true },
                }),
                this.accountCurrency(accountId),
            ]);
            return (0, serialize_bigint_1.serializeBigInt)({
                details: [],
                data: [],
                totalRecords,
                summary: {
                    totalRecords,
                    totalAmount: Number(amountAgg._sum.total_outstanding_amount ?? 0),
                },
                currency,
            });
        }
        return { details: [], totalRecords: 0 };
    }
    async getControlCenter(user, operation) {
        const { accountId } = await this.scope(user);
        const op = operation || "stats";
        if (op === "stats" || op === "agents") {
            const agents = await this.db.user.findMany({
                where: {
                    account_id: accountId,
                    status: "Active",
                    role: { in: [...COLLECTION_ROLES] },
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    first_name: true,
                    last_name: true,
                    role: true,
                    image: true,
                    business_unit_id: true,
                },
                orderBy: { name: "asc" },
            });
            const [activeCustomers, overdueInvoices, openDisputes] = await Promise.all([
                this.db.customer.count({
                    where: {
                        account_id: accountId,
                        collection_status: "Active",
                    },
                }),
                this.db.invoice.count({
                    where: {
                        account_id: accountId,
                        status: "Overdue",
                    },
                }),
                this.db.customerDispute.count({
                    where: {
                        Customer: { account_id: accountId },
                        dispute_status: {
                            notIn: ["Resolved", "Cancelled"],
                        },
                    },
                }),
            ]);
            return (0, serialize_bigint_1.serializeBigInt)({
                agents,
                agentCount: agents.length,
                stats: {
                    activeCustomers,
                    overdueInvoices,
                    openDisputes,
                },
                noContacts: { active: 0, inactive: 0 },
                invalidContacts: { active: 0, inactive: 0 },
                invoicesWithoutCustomer: { total: 0 },
                orphanCreditInvoices: { total: 0 },
            });
        }
        throw new common_1.NotFoundException({
            error: "Control center endpoint not found",
        });
    }
    async postControlCenter(user, operation, body) {
        void user;
        const op = operation || body.operation;
        if (op === "assign-credit") {
            return {
                success: true,
                message: "Credit assignment acknowledged (Nest stub)",
                affectedCustomerIds: [],
            };
        }
        throw new common_1.NotFoundException({
            error: "Control center POST endpoint not found",
        });
    }
    async getOperationDashboard(user, query = {}) {
        const { userInfo, accountId } = await this.scope(user);
        const currency = await this.accountCurrency(accountId);
        const now = new Date();
        let startDate = query.startDate
            ? new Date(query.startDate)
            : new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate.setHours(0, 0, 0, 0);
        let endDate = query.endDate ? new Date(query.endDate) : new Date(now);
        if (endDate.getHours() === 0 &&
            endDate.getMinutes() === 0 &&
            endDate.getSeconds() === 0) {
            endDate.setHours(23, 59, 59, 999);
        }
        const dateFilter = { gte: startDate, lte: endDate };
        const selectedUserId = query.selectedUserId?.trim() || null;
        const padAccount = accountId.toString().padStart(12, "0");
        const systemUserId = `11111111-1111-1111-1111-${padAccount}`;
        const portalUserId = `00000000-0000-0000-0000-${padAccount}`;
        const agents = await this.db.user.findMany({
            where: {
                account_id: accountId,
                status: "Active",
                deactivated_at: null,
            },
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                first_name: true,
                last_name: true,
            },
        });
        const filteredAgents = agents.filter((a) => !a.id.startsWith("11111111-1111-1111-1111-") &&
            !a.id.startsWith("00000000-0000-0000-0000-"));
        let agentIds = filteredAgents.map((a) => a.id);
        if (selectedUserId) {
            agentIds = agentIds.includes(selectedUserId)
                ? [selectedUserId]
                : [];
        }
        const queryUserIds = selectedUserId
            ? [...agentIds]
            : [...agentIds, systemUserId, portalUserId];
        const daysInRange = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) /
            (1000 * 60 * 60 * 24)) + 1);
        if (queryUserIds.length === 0) {
            return (0, serialize_bigint_1.serializeBigInt)({
                aggregate: {
                    activities: {
                        manual: 0,
                        automated: 0,
                        byType: {
                            SMS: 0,
                            Email: 0,
                            Call: 0,
                            WhatsApp: 0,
                            Internal: 0,
                        },
                        delivered: 0,
                        failed: 0,
                        successRate: 0,
                    },
                    disputes: {
                        created: 0,
                        closed: 0,
                        open: 0,
                        averageResolutionDays: 0,
                    },
                    calls: {
                        total: 0,
                        successful: 0,
                        successRate: 0,
                        byOutcome: {},
                    },
                    promises: {
                        total: 0,
                        fulfilled: 0,
                        fulfillmentRate: 0,
                        totalAmount: 0,
                    },
                    productivity: {
                        averageActivitiesPerAgent: 0,
                        averageActivitiesPerDay: 0,
                        topPerformingAgent: null,
                    },
                    issues: {
                        undeliveredActivities: 0,
                        missingContacts: 0,
                        automationStuck: 0,
                        overdueFollowUps: 0,
                        invalidTemplates: 0,
                    },
                    userCounts: { system: 0, portal: 0 },
                },
                agents: [],
                currency,
                dateRange: {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                },
                disputeTrend: { dates: [], created: [], closed: [] },
                fromCache: false,
            });
        }
        const [activities, disputesCreated, disputesClosed, disputesOpen, openPromisePeriods, fulfilledPromises, missingContacts, automationStuck, overdueFollowUps,] = await Promise.all([
            this.db.activity.findMany({
                where: {
                    account_id: accountId,
                    created_by: { in: queryUserIds },
                    created_at: dateFilter,
                },
                select: {
                    id: true,
                    created_by: true,
                    system_generated: true,
                    type: true,
                    status: true,
                    actual_delivery_time: true,
                    schedule_time: true,
                },
                take: 50000,
            }),
            this.db.customerDispute.findMany({
                where: {
                    Customer: { account_id: accountId },
                    created_at: dateFilter,
                    ...(selectedUserId
                        ? { created_by: selectedUserId }
                        : {}),
                },
                select: {
                    id: true,
                    created_at: true,
                    closed_at: true,
                    dispute_status: true,
                    created_by: true,
                    owner_id: true,
                },
                take: 20000,
            }),
            this.db.customerDispute.findMany({
                where: {
                    Customer: { account_id: accountId },
                    dispute_status: { in: ["Resolved", "Cancelled"] },
                    closed_at: dateFilter,
                    ...(selectedUserId
                        ? {
                            OR: [
                                { created_by: selectedUserId },
                                { owner_id: selectedUserId },
                            ],
                        }
                        : {}),
                },
                select: {
                    id: true,
                    created_at: true,
                    closed_at: true,
                    dispute_status: true,
                    created_by: true,
                    owner_id: true,
                },
                take: 20000,
            }),
            this.db.customerDispute.count({
                where: {
                    Customer: { account_id: accountId },
                    dispute_status: {
                        notIn: ["Resolved", "Cancelled"],
                    },
                    ...(selectedUserId
                        ? {
                            OR: [
                                { created_by: selectedUserId },
                                { owner_id: selectedUserId },
                            ],
                        }
                        : {}),
                },
            }),
            this.db.customerCollectionPeriod.findMany({
                where: {
                    Customer: {
                        account_id: accountId,
                        ...(selectedUserId
                            ? { owner_id: selectedUserId }
                            : {}),
                    },
                    current_category: "Promise_to_pay",
                    period_end_date: null,
                },
                select: {
                    promise_to_pay_amount: true,
                    Customer: { select: { owner_id: true } },
                },
            }),
            this.db.customerCollectionPeriod.count({
                where: {
                    Customer: {
                        account_id: accountId,
                        ...(selectedUserId
                            ? { owner_id: selectedUserId }
                            : {}),
                    },
                    previous_category: "Promise_to_pay",
                    current_category: { not: "Promise_to_pay" },
                    modified_at: dateFilter,
                },
            }),
            this.db.customer.count({
                where: {
                    account_id: accountId,
                    collection_status: "Active",
                    ...(selectedUserId
                        ? { owner_id: selectedUserId }
                        : {}),
                    Contact: { none: {} },
                },
            }),
            this.db.customer.count({
                where: {
                    account_id: accountId,
                    automation_stuck_no_contacts: true,
                    ...(selectedUserId
                        ? { owner_id: selectedUserId }
                        : {}),
                },
            }),
            this.db.activity.count({
                where: {
                    account_id: accountId,
                    created_by: { in: queryUserIds },
                    schedule_time: { lt: new Date() },
                    status: { in: ["SCHEDULED", "SENT"] },
                    actual_delivery_time: null,
                },
            }),
        ]);
        const byType = {
            SMS: 0,
            Email: 0,
            Call: 0,
            WhatsApp: 0,
            Internal: 0,
        };
        let manual = 0;
        let automated = 0;
        let delivered = 0;
        let failed = 0;
        const calls = [];
        const activitiesByAgent = new Map();
        for (const a of activities) {
            const t = (a.type || "Internal");
            if (t in byType) {
                byType[t] += 1;
            }
            else {
                byType.Internal += 1;
            }
            if (a.system_generated) {
                automated += 1;
            }
            else {
                manual += 1;
            }
            if (a.actual_delivery_time) {
                delivered += 1;
            }
            if (a.status === "FAILED" || a.status === "BOUNCED") {
                failed += 1;
            }
            if (a.type === "Call") {
                calls.push(a);
            }
            if (a.created_by) {
                if (!activitiesByAgent.has(a.created_by)) {
                    activitiesByAgent.set(a.created_by, []);
                }
                activitiesByAgent.get(a.created_by).push(a);
            }
        }
        const successfulCalls = calls.filter((c) => c.status === "DELIVERED" || Boolean(c.actual_delivery_time)).length;
        const promiseAmount = openPromisePeriods.reduce((sum, p) => sum + (p.promise_to_pay_amount || 0), 0);
        const agentStats = filteredAgents
            .filter((a) => agentIds.includes(a.id))
            .map((agent) => {
            const agentActivities = activitiesByAgent.get(agent.id) || [];
            const agentByType = {
                SMS: 0,
                Email: 0,
                Call: 0,
                WhatsApp: 0,
                Internal: 0,
            };
            let agentManual = 0;
            let agentAutomated = 0;
            let agentDelivered = 0;
            let agentFailed = 0;
            for (const a of agentActivities) {
                const t = a.type || "Internal";
                agentByType[t] = (agentByType[t] || 0) + 1;
                if (a.system_generated) {
                    agentAutomated += 1;
                }
                else {
                    agentManual += 1;
                }
                if (a.actual_delivery_time) {
                    agentDelivered += 1;
                }
                if (a.status === "FAILED" || a.status === "BOUNCED") {
                    agentFailed += 1;
                }
            }
            const agentCalls = agentActivities.filter((a) => a.type === "Call");
            const agentDisputesCreated = disputesCreated.filter((d) => d.created_by === agent.id || d.owner_id === agent.id);
            const agentDisputesClosed = disputesClosed.filter((d) => d.created_by === agent.id || d.owner_id === agent.id);
            const agentPromises = openPromisePeriods.filter((p) => p.Customer?.owner_id === agent.id);
            return {
                userId: agent.id,
                name: agent.name ||
                    `${agent.first_name || ""} ${agent.last_name || ""}`.trim() ||
                    agent.email,
                email: agent.email,
                image: agent.image,
                activities: {
                    manual: agentManual,
                    automated: agentAutomated,
                    byType: agentByType,
                    delivered: agentDelivered,
                    failed: agentFailed,
                },
                disputes: {
                    created: agentDisputesCreated.length,
                    closed: agentDisputesClosed.length,
                    open: 0,
                },
                calls: {
                    total: agentCalls.length,
                    successful: agentCalls.filter((c) => c.status === "DELIVERED" ||
                        Boolean(c.actual_delivery_time)).length,
                    byOutcome: {},
                },
                promises: {
                    total: agentPromises.length,
                    fulfilled: 0,
                    totalAmount: agentPromises.reduce((s, p) => s + (p.promise_to_pay_amount || 0), 0),
                },
                productivity: {
                    activitiesPerDay: agentActivities.length / daysInRange,
                    averageDisputeResolutionDays: 0,
                },
                issues: {
                    undeliveredActivities: agentFailed,
                    missingContacts: 0,
                    automationStuck: 0,
                    overdueFollowUps: 0,
                },
            };
        });
        let topPerformingAgent = null;
        for (const a of agentStats) {
            const count = a.activities.manual + a.activities.automated;
            if (!topPerformingAgent ||
                count > topPerformingAgent.activities) {
                topPerformingAgent = {
                    userId: a.userId,
                    name: a.name || a.email || "Unknown",
                    activities: count,
                };
            }
        }
        const disputeTrendByDate = new Map();
        const cursor = new Date(startDate);
        while (cursor <= endDate) {
            const key = cursor.toISOString().split("T")[0];
            disputeTrendByDate.set(key, { created: 0, closed: 0 });
            cursor.setDate(cursor.getDate() + 1);
        }
        for (const d of disputesCreated) {
            if (d.created_at) {
                const key = d.created_at.toISOString().split("T")[0];
                const row = disputeTrendByDate.get(key);
                if (row) {
                    row.created += 1;
                }
            }
        }
        for (const d of disputesClosed) {
            if (d.closed_at) {
                const key = d.closed_at.toISOString().split("T")[0];
                const row = disputeTrendByDate.get(key);
                if (row) {
                    row.closed += 1;
                }
            }
        }
        const sortedDates = Array.from(disputeTrendByDate.keys()).sort();
        void userInfo;
        return (0, serialize_bigint_1.serializeBigInt)({
            aggregate: {
                activities: {
                    manual,
                    automated,
                    byType,
                    delivered,
                    failed,
                    successRate: activities.length > 0
                        ? (delivered / activities.length) * 100
                        : 0,
                },
                disputes: {
                    created: disputesCreated.length,
                    closed: disputesClosed.length,
                    open: disputesOpen,
                    averageResolutionDays: 0,
                },
                calls: {
                    total: calls.length,
                    successful: successfulCalls,
                    successRate: calls.length > 0
                        ? (successfulCalls / calls.length) * 100
                        : 0,
                    byOutcome: {},
                },
                promises: {
                    total: openPromisePeriods.length,
                    fulfilled: fulfilledPromises,
                    fulfillmentRate: openPromisePeriods.length > 0
                        ? (fulfilledPromises /
                            (openPromisePeriods.length +
                                fulfilledPromises)) *
                            100
                        : 0,
                    totalAmount: promiseAmount,
                },
                productivity: {
                    averageActivitiesPerAgent: agentIds.length > 0
                        ? activities.length / agentIds.length
                        : 0,
                    averageActivitiesPerDay: activities.length / daysInRange,
                    topPerformingAgent,
                },
                issues: {
                    undeliveredActivities: failed,
                    missingContacts,
                    automationStuck,
                    overdueFollowUps,
                    invalidTemplates: 0,
                },
                userCounts: {
                    system: activities.filter((a) => a.created_by === systemUserId).length,
                    portal: activities.filter((a) => a.created_by === portalUserId).length,
                },
            },
            agents: agentStats,
            currency,
            dateRange: {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
            },
            disputeTrend: {
                dates: sortedDates,
                created: sortedDates.map((d) => disputeTrendByDate.get(d)?.created || 0),
                closed: sortedDates.map((d) => disputeTrendByDate.get(d)?.closed || 0),
            },
            fromCache: false,
        });
    }
    async getOperationDashboardDetails(_user, _query = {}) {
        return (0, serialize_bigint_1.serializeBigInt)({
            data: [],
            totalRecords: 0,
            hasMore: false,
        });
    }
    agentsCustomerSelect() {
        return {
            id: true,
            customer_number: true,
            total_overdue_amount: true,
            number_of_overdue_invoices: true,
            oldest_invoice_overdue_date: true,
            owner_id: true,
            country_id: true,
            state_id: true,
            business_unit_id: true,
            Company: { select: { name: true } },
            Person: {
                select: {
                    first_name: true,
                    last_name: true,
                },
            },
            Country: {
                select: { id: true, name: true, iso2: true },
            },
            State: {
                select: { id: true, name: true, iso2: true },
            },
            BusinessUnit: {
                select: { id: true, name: true },
            },
        };
    }
    async getAgents(user, query = {}) {
        const { accountId } = await this.scope(user);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const search = query.search || "";
        const skip = (page - 1) * limit;
        const currency = await this.accountCurrency(accountId);
        const businessUnitId = query.businessUnitId
            ? parseInt(String(query.businessUnitId), 10)
            : NaN;
        const outcome = query.outcome || "";
        const where = {
            current_category: "Agent",
            period_end_date: null,
            ...(outcome ? { last_call_result: outcome } : {}),
            Customer: {
                account_id: accountId,
                collection_status: "Active",
                ...(Number.isFinite(businessUnitId)
                    ? { business_unit_id: businessUnitId }
                    : {}),
                ...(search
                    ? {
                        OR: [
                            {
                                customer_number: {
                                    contains: search,
                                    mode: "insensitive",
                                },
                            },
                            {
                                Company: {
                                    name: {
                                        contains: search,
                                        mode: "insensitive",
                                    },
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
                        ],
                    }
                    : {}),
            },
        };
        const [periods, totalRecords] = await Promise.all([
            this.db.customerCollectionPeriod.findMany({
                where,
                include: {
                    Customer: {
                        select: this.agentsCustomerSelect(),
                    },
                },
                skip,
                take: limit,
                orderBy: { last_call: "desc" },
            }),
            this.db.customerCollectionPeriod.count({ where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({
            agents: periods,
            totalRecords,
            currentPage: page,
            totalPages: Math.ceil(totalRecords / limit) || 0,
            currency,
        });
    }
    async getAgentsFollowUp(user) {
        const { accountId } = await this.scope(user);
        const currency = await this.accountCurrency(accountId);
        const now = new Date();
        const periods = await this.db.customerCollectionPeriod.findMany({
            where: {
                follow_up_time: { lte: now },
                period_end_date: null,
                Customer: {
                    account_id: accountId,
                    collection_status: "Active",
                },
            },
            include: {
                Customer: {
                    select: this.agentsCustomerSelect(),
                },
            },
            take: 100,
            orderBy: { follow_up_time: "asc" },
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            agents: periods,
            followUps: periods,
            totalRecords: periods.length,
            currency,
        });
    }
    async getAgentsStats(user, query = {}) {
        const { accountId } = await this.scope(user);
        const currency = await this.accountCurrency(accountId);
        const search = query.search || "";
        const outcome = query.outcome || "";
        const businessUnitId = query.businessUnitId
            ? parseInt(String(query.businessUnitId), 10)
            : NaN;
        const where = {
            current_category: "Agent",
            period_end_date: null,
            ...(outcome ? { last_call_result: outcome } : {}),
            Customer: {
                account_id: accountId,
                collection_status: "Active",
                ...(Number.isFinite(businessUnitId)
                    ? { business_unit_id: businessUnitId }
                    : {}),
                ...(search
                    ? {
                        OR: [
                            {
                                customer_number: {
                                    contains: search,
                                    mode: "insensitive",
                                },
                            },
                            {
                                Company: {
                                    name: {
                                        contains: search,
                                        mode: "insensitive",
                                    },
                                },
                            },
                        ],
                    }
                    : {}),
            },
        };
        const [totalCustomers, periods, totalOutstanding] = await Promise.all([
            this.db.customerCollectionPeriod.count({ where }),
            this.db.customerCollectionPeriod.findMany({
                where,
                select: { customer_id: true },
            }),
            this.db.customerCollectionPeriod.aggregate({
                where,
                _sum: { total_outstanding_amount: true },
            }),
        ]);
        const customerIds = [
            ...new Set(periods
                .map((p) => p.customer_id)
                .filter((id) => id != null)),
        ];
        const totalInvoices = customerIds.length === 0
            ? 0
            : await this.db.invoice.count({
                where: {
                    customer_id: { in: customerIds },
                    status: { notIn: ["Paid", "Void", "Cancelled"] },
                    due_date: { lt: new Date() },
                },
            });
        return (0, serialize_bigint_1.serializeBigInt)({
            stats: {
                counts: {
                    total_customers: totalCustomers,
                    total_invoices: totalInvoices,
                    total_outstanding_amount: Number(totalOutstanding._sum.total_outstanding_amount ?? 0),
                    currency,
                },
            },
            totalAgents: totalCustomers,
            totalOutstandingAmount: Number(totalOutstanding._sum.total_outstanding_amount ?? 0),
        });
    }
    async getPromiseToPay(user, query = {}) {
        const { accountId } = await this.scope(user);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const search = query.search || "";
        const skip = (page - 1) * limit;
        const where = {
            current_category: "Promise_to_pay",
            period_end_date: null,
            Customer: {
                account_id: accountId,
                collection_status: "Active",
                ...(search
                    ? {
                        OR: [
                            {
                                customer_number: {
                                    contains: search,
                                    mode: "insensitive",
                                },
                            },
                            {
                                Company: {
                                    name: {
                                        contains: search,
                                        mode: "insensitive",
                                    },
                                },
                            },
                        ],
                    }
                    : {}),
            },
        };
        const [promiseToPayList, totalRecords] = await Promise.all([
            this.db.customerCollectionPeriod.findMany({
                where,
                include: {
                    Customer: {
                        select: {
                            id: true,
                            customer_number: true,
                            total_overdue_amount: true,
                            number_of_overdue_invoices: true,
                            oldest_invoice_overdue_date: true,
                            Company: { select: { name: true } },
                            Person: {
                                select: {
                                    first_name: true,
                                    last_name: true,
                                },
                            },
                        },
                    },
                },
                skip,
                take: limit,
                orderBy: { promise_to_pay_date: "asc" },
            }),
            this.db.customerCollectionPeriod.count({ where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({ promiseToPayList, totalRecords });
    }
    async getPromiseToPayStats(user) {
        const { accountId } = await this.scope(user);
        const [count, agg] = await Promise.all([
            this.db.customerCollectionPeriod.count({
                where: {
                    current_category: "Promise_to_pay",
                    period_end_date: null,
                    Customer: {
                        account_id: accountId,
                        collection_status: "Active",
                    },
                },
            }),
            this.db.customerCollectionPeriod.aggregate({
                where: {
                    current_category: "Promise_to_pay",
                    period_end_date: null,
                    Customer: {
                        account_id: accountId,
                        collection_status: "Active",
                    },
                },
                _sum: {
                    promise_to_pay_amount: true,
                    total_outstanding_amount: true,
                },
            }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({
            total: count,
            totalPromiseAmount: Number(agg._sum.promise_to_pay_amount ?? 0),
            totalOutstandingAmount: Number(agg._sum.total_outstanding_amount ?? 0),
        });
    }
    async postPromiseToPay(_user, body) {
        return (0, serialize_bigint_1.serializeBigInt)({
            success: true,
            message: "Promise-to-pay acknowledged",
            body,
        });
    }
    async getCronJobs(_user) {
        try {
            const jobs = await this.db.cronJob.findMany({
                select: {
                    id: true,
                    name: true,
                    created_at: true,
                    active: true,
                    cron_expression: true,
                    last_run_at: true,
                    next_run_at: true,
                    timeout_period_seconds: true,
                    modified_at: true,
                    sort_order: true,
                },
                orderBy: { sort_order: "asc" },
            });
            return (0, serialize_bigint_1.serializeBigInt)({
                cronJobs: jobs.map((job) => ({
                    id: job.id,
                    name: job.name,
                    active: job.active,
                    cronExpression: job.cron_expression,
                    lastRunAt: job.last_run_at,
                    nextRunAt: job.next_run_at,
                    timeoutPeriodSeconds: job.timeout_period_seconds,
                    sortOrder: job.sort_order,
                    createdAt: job.created_at,
                    modifiedAt: job.modified_at,
                })),
            });
        }
        catch {
            return { cronJobs: [], message: "CronJob model unavailable" };
        }
    }
    async postCronJobs(_user, body = {}) {
        return this.triggerCronJob(_user, body);
    }
    async triggerCronJob(user, body = {}) {
        const { userInfo } = await this.scope(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new common_1.ForbiddenException({
                error: "Forbidden - Access restricted to account 10013",
            });
        }
        const jobId = body.jobId != null ? Number(body.jobId) : undefined;
        if (jobId != null && Number.isFinite(jobId)) {
            const job = await this.db.cronJob.findUnique({
                where: { id: jobId },
                select: { id: true, name: true, active: true },
            });
            if (!job) {
                throw new common_1.NotFoundException({ error: "Cron job not found" });
            }
            return {
                success: true,
                message: `Cron job ${job.name} trigger acknowledged`,
                jobId: job.id,
                timestamp: new Date().toISOString(),
            };
        }
        return {
            success: true,
            message: "Cron trigger acknowledged (all due)",
            timestamp: new Date().toISOString(),
            body,
        };
    }
    async getCronJobLogs(user, executionId) {
        const { userInfo } = await this.scope(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new common_1.ForbiddenException({
                error: "Forbidden - Access restricted to account 10013",
            });
        }
        const logs = await this.db.log.findMany({
            where: {
                OR: [
                    { message: { contains: executionId } },
                    { correlation_id: executionId },
                ],
            },
            orderBy: { timestamp: "asc" },
            take: 500,
            select: {
                id: true,
                level: true,
                message: true,
                timestamp: true,
                details: true,
                correlation_id: true,
                job_id: true,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            executionId,
            status: logs.length ? "completed" : "unknown",
            items: logs,
        });
    }
    async getAdminDashboard(user) {
        const { userInfo } = await this.scope(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new common_1.ForbiddenException({
                error: "Forbidden - Access restricted to account 10013",
            });
        }
        const now = Date.now();
        const jobs = await this.db.cronJob.findMany({
            orderBy: { sort_order: "asc" },
        });
        const mapped = jobs.map((job) => {
            const modified = job.modified_at
                ? new Date(job.modified_at).getTime()
                : 0;
            const isRunning = job.active === true;
            const runningDuration = isRunning ? Math.max(0, now - modified) : 0;
            return {
                id: job.id,
                name: job.name,
                cron_expression: job.cron_expression,
                active: job.active,
                last_run_at: job.last_run_at,
                next_run_at: job.next_run_at,
                created_at: job.created_at,
                modified_at: job.modified_at,
                isRunning,
                runningDuration,
            };
        });
        const running = mapped.filter((j) => j.isRunning);
        return (0, serialize_bigint_1.serializeBigInt)({
            jobs: mapped,
            runningJobs: {
                over2Min: running
                    .filter((j) => j.runningDuration >= 2 * 60 * 1000)
                    .map((j) => ({
                    id: j.id,
                    name: j.name,
                    duration: j.runningDuration,
                })),
                over30Min: running
                    .filter((j) => j.runningDuration >= 30 * 60 * 1000)
                    .map((j) => ({
                    id: j.id,
                    name: j.name,
                    duration: j.runningDuration,
                })),
            },
        });
    }
    async getSystemHealth(user) {
        const { userInfo } = await this.scope(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new common_1.ForbiddenException({
                error: "Forbidden - Access restricted to account 10013",
            });
        }
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const allCronJobs = await this.db.cronJob.findMany();
        const overdueJobs = allCronJobs.filter((job) => job.next_run_at && job.next_run_at < now);
        const runningJobs = allCronJobs.filter((job) => job.active === true);
        const jobsNotRunIn24h = allCronJobs.filter((job) => !job.last_run_at || job.last_run_at < twentyFourHoursAgo);
        const totalExecutions = allCronJobs.reduce((sum, job) => sum +
            (job.success_count_30d || 0) +
            (job.failure_count_30d || 0) +
            (job.timeout_count_30d || 0), 0);
        const totalSuccesses = allCronJobs.reduce((sum, job) => sum + (job.success_count_30d || 0), 0);
        const cronJobs = {
            overview: {
                totalJobs: allCronJobs.length,
                overdueCount: overdueJobs.length,
                runningCount: runningJobs.length,
                notRunIn24hCount: jobsNotRunIn24h.length,
                overallSuccessRate: totalExecutions > 0
                    ? (totalSuccesses / totalExecutions) * 100
                    : 0,
            },
            jobs: allCronJobs.map((job) => {
                const totalJobExecutions = (job.success_count_30d || 0) +
                    (job.failure_count_30d || 0) +
                    (job.timeout_count_30d || 0);
                return {
                    id: job.id,
                    name: job.name,
                    lastRunAt: job.last_run_at?.toISOString() || null,
                    nextRunAt: job.next_run_at?.toISOString() || null,
                    lastExecutionDurationSeconds: job.last_execution_duration_seconds,
                    averageExecutionDurationSeconds: job.average_execution_duration_seconds,
                    minExecutionDurationSeconds: job.min_execution_duration_seconds,
                    maxExecutionDurationSeconds: job.max_execution_duration_seconds,
                    timeoutPeriodSeconds: job.timeout_period_seconds,
                    successRate30d: totalJobExecutions > 0
                        ? ((job.success_count_30d || 0) /
                            totalJobExecutions) *
                            100
                        : 0,
                    failureRate30d: totalJobExecutions > 0
                        ? ((job.failure_count_30d || 0) /
                            totalJobExecutions) *
                            100
                        : 0,
                    timeoutRate30d: totalJobExecutions > 0
                        ? ((job.timeout_count_30d || 0) /
                            totalJobExecutions) *
                            100
                        : 0,
                    lastSuccessAt: job.last_success_at?.toISOString() || null,
                    lastFailureAt: job.last_failure_at?.toISOString() || null,
                    lastTimeoutAt: job.last_timeout_at?.toISOString() || null,
                    performanceBaselineSeconds: job.performance_baseline_seconds,
                    performanceDegradationAlertSentAt: job.performance_degradation_alert_sent_at?.toISOString() ||
                        null,
                    active: job.active === true,
                };
            }),
        };
        const countActivity = async (type, since, status) => {
            return this.db.activity.count({
                where: {
                    type,
                    created_at: { gte: since },
                    ...(status ? { status: status } : {}),
                },
            });
        };
        const [emailSent1h, emailSent6h, emailSent24h, emailGen1h, emailGen6h, emailGen24h, emailFail1h, emailFail6h, emailFail24h, smsSent1h, smsSent6h, smsSent24h, smsGen1h, smsGen6h, smsGen24h, smsFail1h, smsFail6h, smsFail24h,] = await Promise.all([
            countActivity("Email", oneHourAgo, "Completed"),
            countActivity("Email", sixHoursAgo, "Completed"),
            countActivity("Email", twentyFourHoursAgo, "Completed"),
            countActivity("Email", oneHourAgo),
            countActivity("Email", sixHoursAgo),
            countActivity("Email", twentyFourHoursAgo),
            countActivity("Email", oneHourAgo, "Failed"),
            countActivity("Email", sixHoursAgo, "Failed"),
            countActivity("Email", twentyFourHoursAgo, "Failed"),
            countActivity("SMS", oneHourAgo, "Completed"),
            countActivity("SMS", sixHoursAgo, "Completed"),
            countActivity("SMS", twentyFourHoursAgo, "Completed"),
            countActivity("SMS", oneHourAgo),
            countActivity("SMS", sixHoursAgo),
            countActivity("SMS", twentyFourHoursAgo),
            countActivity("SMS", oneHourAgo, "Failed"),
            countActivity("SMS", sixHoursAgo, "Failed"),
            countActivity("SMS", twentyFourHoursAgo, "Failed"),
        ]);
        const stuckGrouped = await this.db.activity.groupBy({
            by: ["status_reason"],
            where: {
                status: { in: ["Pending", "Scheduled"] },
                schedule_time: { lt: oneHourAgo },
            },
            _count: { _all: true },
        });
        const importJobs = await this.db.importJob.findMany({
            where: { created_at: { gte: thirtyDaysAgo } },
            select: {
                import_type: true,
                status: true,
                created_at: true,
                started_at: true,
                completed_at: true,
                total_records: true,
                successful_records: true,
                failed_records: true,
            },
        });
        const inWindow = (d, since) => d >= since;
        const jobs24h = importJobs.filter((j) => inWindow(j.created_at, twentyFourHoursAgo));
        const jobs7d = importJobs.filter((j) => inWindow(j.created_at, sevenDaysAgo));
        const pendingCount = importJobs.filter((j) => j.status === "Pending" || j.status === "Processing").length;
        const stuckCount = importJobs.filter((j) => (j.status === "Pending" || j.status === "Processing") &&
            j.created_at < sixHoursAgo).length;
        const completed = importJobs.filter((j) => j.status === "Completed");
        const failed = importJobs.filter((j) => j.status === "Failed");
        const overallSuccessRate = completed.length + failed.length > 0
            ? (completed.length / (completed.length + failed.length)) * 100
            : 0;
        const byTypeMap = new Map();
        for (const job of importJobs) {
            const key = String(job.import_type);
            const entry = byTypeMap.get(key) || {
                importType: key,
                count24h: 0,
                count7d: 0,
                count30d: 0,
                totalRecords: 0,
                successfulRecords: 0,
                failedRecords: 0,
                durations: [],
            };
            entry.count30d += 1;
            if (inWindow(job.created_at, sevenDaysAgo))
                entry.count7d += 1;
            if (inWindow(job.created_at, twentyFourHoursAgo))
                entry.count24h += 1;
            entry.totalRecords += job.total_records || 0;
            entry.successfulRecords += job.successful_records || 0;
            entry.failedRecords += job.failed_records || 0;
            if (job.started_at && job.completed_at) {
                entry.durations.push((job.completed_at.getTime() - job.started_at.getTime()) /
                    1000);
            }
            byTypeMap.set(key, entry);
        }
        const byType = [...byTypeMap.values()].map((e) => {
            const successDenom = e.successfulRecords + e.failedRecords;
            const avgDurationSeconds = e.durations.length > 0
                ? e.durations.reduce((a, b) => a + b, 0) / e.durations.length
                : null;
            return {
                importType: e.importType,
                count24h: e.count24h,
                count7d: e.count7d,
                count30d: e.count30d,
                totalRecords: e.totalRecords,
                successfulRecords: e.successfulRecords,
                failedRecords: e.failedRecords,
                successRate: successDenom > 0
                    ? (e.successfulRecords / successDenom) * 100
                    : 0,
                avgDurationSeconds,
                recordsPerHour: avgDurationSeconds && avgDurationSeconds > 0
                    ? (e.totalRecords / avgDurationSeconds) * 3600
                    : 0,
            };
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            cronJobs,
            activities: {
                email: {
                    sent1h: emailSent1h,
                    sent6h: emailSent6h,
                    sent24h: emailSent24h,
                    generated1h: emailGen1h,
                    generated6h: emailGen6h,
                    generated24h: emailGen24h,
                    failed1h: emailFail1h,
                    failed6h: emailFail6h,
                    failed24h: emailFail24h,
                    bounced1h: 0,
                    bounced6h: 0,
                    bounced24h: 0,
                },
                sms: {
                    sent1h: smsSent1h,
                    sent6h: smsSent6h,
                    sent24h: smsSent24h,
                    generated1h: smsGen1h,
                    generated6h: smsGen6h,
                    generated24h: smsGen24h,
                    failed1h: smsFail1h,
                    failed6h: smsFail6h,
                    failed24h: smsFail24h,
                },
                stuck: {
                    total: stuckGrouped.reduce((s, g) => s + (g._count._all || 0), 0),
                    byReason: stuckGrouped.map((g) => ({
                        reason: g.status_reason || "unknown",
                        count: g._count._all,
                    })),
                },
            },
            imports: {
                overview: {
                    total24h: jobs24h.length,
                    total7d: jobs7d.length,
                    total30d: importJobs.length,
                    pendingCount,
                    stuckCount,
                    overallSuccessRate,
                    avgProcessingTimeSeconds: null,
                    recordsPerHour: 0,
                },
                byType,
            },
        });
    }
    async listCompanies(_user) {
        const companies = await this.db.company.findMany({
            select: { id: true, name: true },
            orderBy: { name: "asc" },
        });
        return (0, serialize_bigint_1.serializeBigInt)({ items: companies });
    }
    async createCompany(user, body) {
        if (!body.name?.trim()) {
            throw new common_1.BadRequestException({
                error: "Company name is required",
            });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const company = await this.db.company.create({
            data: {
                name: body.name.trim(),
                company_number: body.company_number || null,
                created_by: userInfo.userId,
                modified_by: userInfo.userId,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(company);
    }
    async updateCompany(user, body) {
        if (body.id == null || !Number.isFinite(Number(body.id))) {
            throw new common_1.BadRequestException({
                error: "Company ID is required",
            });
        }
        if (!body.name?.trim()) {
            throw new common_1.BadRequestException({
                error: "Company name is required",
            });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const updated = await this.db.company.update({
            where: { id: Number(body.id) },
            data: {
                name: body.name.trim(),
                modified_by: userInfo.userId,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
    async cacheInvalidation(body) {
        const source = body.source;
        const reason = body.reason;
        if (!source || source !== "cron-job") {
            throw new common_1.BadRequestException({
                error: "Invalid source or missing source",
            });
        }
        if (!reason) {
            throw new common_1.BadRequestException({
                error: "Missing reason for cache invalidation",
            });
        }
        return {
            success: true,
            message: "Cache invalidation request received",
            timestamp: new Date().toISOString(),
            source,
            reason,
            affectedCustomerIds: body.affectedCustomerIds || [],
            affectedInvoiceIds: body.affectedInvoiceIds || [],
        };
    }
    async getSharedStats(user, operation) {
        const { accountId } = await this.scope(user);
        const currency = await this.accountCurrency(accountId);
        switch (operation) {
            case "customers": {
                const totalCustomers = await this.db.customer.count({
                    where: {
                        account_id: accountId,
                        collection_status: "Active",
                    },
                });
                return { total_accounts: totalCustomers, currency };
            }
            case "amount": {
                const overdue = await this.db.invoice.aggregate({
                    where: {
                        account_id: accountId,
                        status: "Overdue",
                    },
                    _sum: { outstanding_debt: true },
                });
                return {
                    total_overdue_amount: Number(overdue._sum.outstanding_debt ?? 0),
                    currency,
                };
            }
            case "legal":
                return { total: 0, currency };
            case "dispute": {
                const open = await this.db.customerDispute.count({
                    where: {
                        Customer: { account_id: accountId },
                        dispute_status: {
                            notIn: ["Resolved", "Cancelled"],
                        },
                    },
                });
                return { total: open, currency };
            }
            case "agent": {
                const total = await this.db.customerCollectionPeriod.count({
                    where: {
                        current_category: "Agent",
                        period_end_date: null,
                        Customer: {
                            account_id: accountId,
                            collection_status: "Active",
                        },
                    },
                });
                return { total, currency };
            }
            case "promise-to-pay": {
                const total = await this.db.customerCollectionPeriod.count({
                    where: {
                        current_category: "Promise_to_pay",
                        period_end_date: null,
                        Customer: {
                            account_id: accountId,
                            collection_status: "Active",
                        },
                    },
                });
                return { total, currency };
            }
            default:
                throw new common_1.NotFoundException({
                    error: `Unknown shared-stats operation: ${operation}`,
                });
        }
    }
};
exports.SystemService = SystemService;
exports.SystemService = SystemService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], SystemService);
//# sourceMappingURL=system.service.js.map