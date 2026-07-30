import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import {
    buildAgingRangeRows,
    buildAudienceReportChart,
    buildCollectionEffortsPhase,
    buildCollectionStat,
    reconstructDashboardFromCache,
} from "./financial-dashboard.builder";

const COLLECTION_ROLES = [
    "Collection_Agent",
    "Collection_Manager",
] as const;

const OPEN_INVOICE_STATUSES = [
    "Due",
    "Open",
    "Partially_Paid",
    "Overdue",
] as const;

const LINKED_PAYMENT = { invoice_id: { gt: 0 } } as const;

/**
 * Canonical aging buckets. The keys are a shared contract: the dashboard table
 * turns them into drill-down URLs and into `values.aging_ranges_*` translation
 * lookups, and chart-details maps them back to a due_date window. They must
 * stay underscore-spelled to match AGING_DAYS_RANGE_MAP on the web side.
 */
const AGING_BUCKETS = [
    { daysRange: "0_7", min: 0, max: 7 },
    { daysRange: "8_30", min: 8, max: 30 },
    { daysRange: "31_60", min: 31, max: 60 },
    { daysRange: "61_90", min: 61, max: 90 },
    { daysRange: "91_180", min: 91, max: 180 },
    { daysRange: "181_365", min: 181, max: 365 },
    { daysRange: "365_2000", min: 366, max: 9999 },
] as const;

/** Unpaid statuses the invoice drill-downs count as still outstanding. */
const UNPAID_INVOICE_STATUSES = [
    "Open",
    "Overdue",
    "Partially_Paid",
    "Under_Dispute",
    "Due",
    "Draft",
    "Sent",
    "Viewed",
] as const;

export type SystemListQuery = Record<string, string | undefined>;

@Injectable()
export class SystemService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    private async scope(user: JwtPayload) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        return { userInfo, accountId };
    }

    private emptyChart() {
        return { options: {}, series: [] };
    }

    private startOfUtcDay(d: Date): Date {
        const x = new Date(d);
        x.setUTCHours(0, 0, 0, 0);
        return x;
    }

    private endOfUtcDay(d: Date): Date {
        const x = new Date(d);
        x.setUTCHours(23, 59, 59, 999);
        return x;
    }

    private addDays(d: Date, days: number): Date {
        const x = new Date(d);
        x.setUTCDate(x.getUTCDate() + days);
        return x;
    }

    private async accountCurrency(accountId: number): Promise<string> {
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { currency: true },
        });
        return account?.currency || "USD";
    }

    private async sumOutstanding(
        accountId: number,
        extra: Record<string, unknown> = {}
    ): Promise<{ amount: number; count: number }> {
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

    private dashboardCacheKey(
        accountId: number,
        viewMode: string,
        businessUnitId?: string | null,
        ownerId?: string | null
    ): string {
        return `${accountId}_${businessUnitId || "all"}_${ownerId || "all"}_${viewMode}`;
    }

    private async tryDashboardCache(
        accountId: number,
        viewMode: string,
        query: SystemListQuery
    ): Promise<Record<string, unknown> | null> {
        if (query.bypassCache === "true" || query.invalidateCache === "true") {
            return null;
        }
        const cacheKey = this.dashboardCacheKey(
            accountId,
            viewMode,
            query.businessUnitId,
            query.ownerId
        );
        try {
            const cached = await this.db.dashboardCache.findUnique({
                where: { cache_key: cacheKey },
            });
            if (!cached) {
                return null;
            }
            // Prefer non-expired; still use expired cache for charts if present
            // (UI shows cacheAge / lastSynced).
            const chart = cached.chart_data as Record<string, unknown> | null;
            const hasCharts =
                Boolean(
                    (chart?.audienceReport as { series?: unknown[] })?.series
                        ?.length
                ) ||
                Boolean(
                    (
                        chart?.collectionEffortsPhase as {
                            series?: unknown[];
                        }
                    )?.series?.length
                ) ||
                (Array.isArray(cached.collection_stats) &&
                    (cached.collection_stats as unknown[]).length > 0);
            if (!hasCharts && cached.expires_at < new Date()) {
                return null;
            }
            return reconstructDashboardFromCache({
                ...cached,
                chart_data:
                    cached.chart_data &&
                    typeof cached.chart_data === "object" &&
                    !Array.isArray(cached.chart_data)
                        ? (cached.chart_data as Record<string, unknown>)
                        : null,
            });
        } catch {
            return null;
        }
    }

    private async buildCollectedVsPromiseSeries(accountId: number) {
        const now = new Date();
        const collectedData: number[] = [];
        const promiseToPayData: number[] = [];

        for (let i = 5; i >= 0; i--) {
            const target = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthStart = new Date(
                target.getFullYear(),
                target.getMonth(),
                1
            );
            const monthEnd = new Date(
                target.getFullYear(),
                target.getMonth() + 1,
                0,
                23,
                59,
                59,
                999
            );
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
            promiseToPayData.push(
                Math.round(Number(promise._sum.promise_to_pay_amount ?? 0))
            );
        }

        return buildAudienceReportChart(collectedData, promiseToPayData, now);
    }

    private async buildCategoryWidgets(accountId: number, currency: string) {
        const categories = [
            "Automated",
            "Agent",
            "Promise_to_pay",
            "Dispute",
            "Legal",
        ] as const;

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

        const byCat = new Map(
            periodGroups.map((g) => [g.current_category as string, g])
        );

        const counts = {
            Automated: byCat.get("Automated")?._count._all || 0,
            Agent: byCat.get("Agent")?._count._all || 0,
            Promise_to_pay: byCat.get("Promise_to_pay")?._count._all || 0,
            Dispute: byCat.get("Dispute")?._count._all || 0,
            Legal: byCat.get("Legal")?._count._all || 0,
        };

        const collectionEffortsPhase = buildCollectionEffortsPhase(counts);

        const collectionStats = [
            buildCollectionStat(
                "In Dispute",
                counts.Dispute,
                Number(byCat.get("Dispute")?._sum.no_of_overdue_invoices ?? 0),
                Number(byCat.get("Dispute")?._sum.total_outstanding_amount ?? 0),
                currency
            ),
            buildCollectionStat(
                "Promise to Pay",
                counts.Promise_to_pay,
                Number(
                    byCat.get("Promise_to_pay")?._sum.no_of_overdue_invoices ?? 0
                ),
                Number(
                    byCat.get("Promise_to_pay")?._sum.promise_to_pay_amount ??
                        byCat.get("Promise_to_pay")?._sum
                            .total_outstanding_amount ??
                        0
                ),
                currency
            ),
            buildCollectionStat(
                "Automated",
                counts.Automated,
                Number(
                    byCat.get("Automated")?._sum.no_of_overdue_invoices ?? 0
                ),
                Number(
                    byCat.get("Automated")?._sum.total_outstanding_amount ?? 0
                ),
                currency
            ),
            buildCollectionStat(
                "Agent",
                counts.Agent,
                Number(byCat.get("Agent")?._sum.no_of_overdue_invoices ?? 0),
                Number(byCat.get("Agent")?._sum.total_outstanding_amount ?? 0),
                currency
            ),
        ];

        return { collectionEffortsPhase, collectionStats };
    }

    private async buildAgingPortfolio(accountId: number) {
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
                const days = Math.floor(
                    (today.getTime() - inv.due_date.getTime()) /
                        (1000 * 60 * 60 * 24)
                );
                return days >= r.min && days <= r.max;
            });
            const customers = new Set(
                inRange
                    .map((i) => i.customer_id)
                    .filter((id): id is number => id != null)
            );
            const amount = inRange.reduce(
                (s, i) => s + Number(i.outstanding_debt ?? 0),
                0
            );
            return {
                daysRange: r.daysRange,
                invoices: inRange.length,
                accounts: customers.size,
                amount,
            };
        });

        return {
            chartData: buildAgingRangeRows(buckets),
            details: [],
        };
    }

    async getDashboard(user: JwtPayload, query: SystemListQuery = {}) {
        const { accountId } = await this.scope(user);
        const viewMode =
            query.viewMode === "parent" || query.viewMode === "child"
                ? query.viewMode
                : "child";

        const cached = await this.tryDashboardCache(
            accountId,
            viewMode,
            query
        );
        if (cached) {
            return serializeBigInt(cached);
        }

        const currency = await this.accountCurrency(accountId);
        const today = this.startOfUtcDay(new Date());
        const endToday = this.endOfUtcDay(today);
        const endWeek = this.endOfUtcDay(this.addDays(today, 7));
        const endMonth = this.endOfUtcDay(
            new Date(
                Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
            )
        );
        const startNextMonth = this.startOfUtcDay(
            new Date(
                Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)
            )
        );
        const endNextMonth = this.endOfUtcDay(
            new Date(
                Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0)
            )
        );
        const monthStart = new Date(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            1
        );
        const monthEnd = new Date(
            today.getUTCFullYear(),
            today.getUTCMonth() + 1,
            0,
            23,
            59,
            59,
            999
        );

        const overdueWhere = {
            account_id: accountId,
            status: "Overdue" as const,
        };

        const [
            overdueAgg,
            overdueInvoices,
            overdueCustomerGroups,
            collectedMtdAgg,
            totalDue,
            dueToday,
            dueThisWeek,
            dueThisMonth,
            dueNextMonth,
            disputeClosed,
            disputeInvoiceCount,
            disputeAmountAgg,
            uniqueDisputeCustomers,
            childBuCount,
            audienceReport,
            categoryWidgets,
            agingPortfolio,
        ] = await Promise.all([
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
                totalDisputeAmount: Number(
                    disputeAmountAgg._sum.outstanding_debt ?? 0
                ),
                uniqueCustomerCount: uniqueDisputeCustomers.length,
                disputeInvoiceCount,
                totalClosed: disputeClosed,
            },
            audienceReport,
            agingPortfolio,
            collectionEffortsPhase: categoryWidgets.collectionEffortsPhase,
            automatedPhaseSplit: this.emptyChart(),
            activeCustomersChart: this.emptyChart(),
            receivablesMaturitySchedule: [],
            invoicesByCustomer: [],
            invoicesByBusinessUnit: [],
            overdueInvoicesByCustomer: [],
            overdueInvoicesByBusinessUnit: [],
            lastSynced: new Date().toISOString(),
            viewMode,
            hasChildBusinessUnits: childBuCount > 0,
            fromCache: false,
        };

        return serializeBigInt(response);
    }

    /** Open collection period (never closed) still carrying outstanding debt. */
    private openCollectionPeriodFilter() {
        return {
            period_end_date: null,
            total_outstanding_amount: { gt: 0 },
        } as const;
    }

    /**
     * Explicitly selected business unit plus its descendants, matching how
     * report execution widens a selected BU.
     */
    private async selectedBusinessUnitFilter(
        query: SystemListQuery
    ): Promise<Record<string, unknown> | null> {
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

    /**
     * Resolve a bucket key, tolerating the hyphen/`365+` spellings that older
     * dashboard builds put into drill-down links.
     */
    private resolveAgingBucket(daysRange?: string | null) {
        if (!daysRange) {
            return null;
        }
        const normalized = daysRange
            .trim()
            .replace(/-/g, "_")
            .replace(/\+$/, "");
        return (
            AGING_BUCKETS.find((b) => b.daysRange === normalized) ??
            AGING_BUCKETS.find((b) =>
                b.daysRange.startsWith(`${normalized}_`)
            ) ??
            null
        );
    }

    async getChartDetails(user: JwtPayload, query: SystemListQuery = {}) {
        const { userInfo, accountId } = await this.scope(user);

        // Invoice-shaped aging drill-down. Rows come from the dashboard_invoices
        // report, so only the summary cards are served here — and they reuse the
        // grid's locked filters so the cards match its record count. Invoice has
        // no owner/business-unit column, so that scope is applied via Customer.
        if (query.type === "aging-portfolio") {
            const bucket = this.resolveAgingBucket(query.daysRange);
            const today = this.startOfUtcDay(new Date());
            const customerScope = [
                ...(await this.accessScope.buildCustomerAccessWhere(userInfo)),
                { collection_status: "Active" as const },
            ];
            const selectedBu = await this.selectedBusinessUnitFilter(query);
            if (selectedBu) {
                customerScope.push(
                    selectedBu as (typeof customerScope)[number]
                );
            }

            const where = {
                account_id: accountId,
                status: { in: [...UNPAID_INVOICE_STATUSES] },
                Customer: { AND: customerScope },
                due_date: bucket
                    ? {
                          gte: this.startOfUtcDay(
                              this.addDays(today, -bucket.max)
                          ),
                          lte: this.endOfUtcDay(
                              this.addDays(today, -bucket.min)
                          ),
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

            return serializeBigInt({
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

        // The overdue drill-downs render their rows from the dashboard_customers
        // report, so only the summary cards are served here. Both types share
        // one predicate with those locked report filters, otherwise the cards
        // and the grid row count would disagree.
        if (
            query.type === "overdue-amount" ||
            query.type === "overdue-customers"
        ) {
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

            return serializeBigInt({
                details: [],
                data: [],
                totalRecords,
                summary: {
                    totalRecords,
                    totalAmount: Number(
                        amountAgg._sum.total_outstanding_amount ?? 0
                    ),
                },
                currency,
            });
        }

        return { details: [], totalRecords: 0 };
    }

    async getControlCenter(user: JwtPayload, operation?: string | null) {
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

            const [activeCustomers, overdueInvoices, openDisputes] =
                await Promise.all([
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

            return serializeBigInt({
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

        throw new NotFoundException({
            error: "Control center endpoint not found",
        });
    }

    async postControlCenter(
        user: JwtPayload,
        operation: string | null | undefined,
        body: Record<string, unknown>
    ) {
        void user;
        const op = operation || (body.operation as string | undefined);
        if (op === "assign-credit") {
            return {
                success: true,
                message: "Credit assignment acknowledged (Nest stub)",
                affectedCustomerIds: [],
            };
        }
        throw new NotFoundException({
            error: "Control center POST endpoint not found",
        });
    }

    async getOperationDashboard(
        user: JwtPayload,
        query: SystemListQuery = {}
    ) {
        const { userInfo, accountId } = await this.scope(user);
        const currency = await this.accountCurrency(accountId);

        const now = new Date();
        let startDate = query.startDate
            ? new Date(query.startDate)
            : new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startDate.setHours(0, 0, 0, 0);
        let endDate = query.endDate ? new Date(query.endDate) : new Date(now);
        if (
            endDate.getHours() === 0 &&
            endDate.getMinutes() === 0 &&
            endDate.getSeconds() === 0
        ) {
            endDate.setHours(23, 59, 59, 999);
        }
        const dateFilter = { gte: startDate, lte: endDate };
        const selectedUserId = query.selectedUserId?.trim() || null;

        const padAccount = accountId.toString().padStart(12, "0");
        const systemUserId = `11111111-1111-1111-1111-${padAccount}`;
        const portalUserId = `00000000-0000-0000-0000-${padAccount}`;

        // Match leaves OperationDashboardService: all Active users, then
        // drop system/portal audit identities (not Collection_*-only).
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

        const filteredAgents = agents.filter(
            (a) =>
                !a.id.startsWith("11111111-1111-1111-1111-") &&
                !a.id.startsWith("00000000-0000-0000-0000-")
        );
        let agentIds = filteredAgents.map((a) => a.id);
        if (selectedUserId) {
            agentIds = agentIds.includes(selectedUserId)
                ? [selectedUserId]
                : [];
        }

        const queryUserIds = selectedUserId
            ? [...agentIds]
            : [...agentIds, systemUserId, portalUserId];

        const daysInRange = Math.max(
            1,
            Math.ceil(
                (endDate.getTime() - startDate.getTime()) /
                    (1000 * 60 * 60 * 24)
            ) + 1
        );

        if (queryUserIds.length === 0) {
            return serializeBigInt({
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

        const [
            activities,
            disputesCreated,
            disputesClosed,
            disputesOpen,
            openPromisePeriods,
            fulfilledPromises,
            missingContacts,
            automationStuck,
            overdueFollowUps,
        ] = await Promise.all([
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
        const calls: typeof activities = [];
        const activitiesByAgent = new Map<string, typeof activities>();

        for (const a of activities) {
            const t = (a.type || "Internal") as keyof typeof byType;
            if (t in byType) {
                byType[t] += 1;
            } else {
                byType.Internal += 1;
            }
            if (a.system_generated) {
                automated += 1;
            } else {
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
                activitiesByAgent.get(a.created_by)!.push(a);
            }
        }

        const successfulCalls = calls.filter(
            (c) => c.status === "DELIVERED" || Boolean(c.actual_delivery_time)
        ).length;
        const promiseAmount = openPromisePeriods.reduce(
            (sum, p) => sum + (p.promise_to_pay_amount || 0),
            0
        );

        const agentStats = filteredAgents
            .filter((a) => agentIds.includes(a.id))
            .map((agent) => {
                const agentActivities =
                    activitiesByAgent.get(agent.id) || [];
                const agentByType: Record<string, number> = {
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
                    } else {
                        agentManual += 1;
                    }
                    if (a.actual_delivery_time) {
                        agentDelivered += 1;
                    }
                    if (a.status === "FAILED" || a.status === "BOUNCED") {
                        agentFailed += 1;
                    }
                }
                const agentCalls = agentActivities.filter(
                    (a) => a.type === "Call"
                );
                const agentDisputesCreated = disputesCreated.filter(
                    (d) =>
                        d.created_by === agent.id || d.owner_id === agent.id
                );
                const agentDisputesClosed = disputesClosed.filter(
                    (d) =>
                        d.created_by === agent.id || d.owner_id === agent.id
                );
                const agentPromises = openPromisePeriods.filter(
                    (p) => p.Customer?.owner_id === agent.id
                );
                return {
                    userId: agent.id,
                    name:
                        agent.name ||
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
                        successful: agentCalls.filter(
                            (c) =>
                                c.status === "DELIVERED" ||
                                Boolean(c.actual_delivery_time)
                        ).length,
                        byOutcome: {},
                    },
                    promises: {
                        total: agentPromises.length,
                        fulfilled: 0,
                        totalAmount: agentPromises.reduce(
                            (s, p) => s + (p.promise_to_pay_amount || 0),
                            0
                        ),
                    },
                    productivity: {
                        activitiesPerDay:
                            agentActivities.length / daysInRange,
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

        let topPerformingAgent: {
            userId: string;
            name: string;
            activities: number;
        } | null = null;
        for (const a of agentStats) {
            const count = a.activities.manual + a.activities.automated;
            if (
                !topPerformingAgent ||
                count > topPerformingAgent.activities
            ) {
                topPerformingAgent = {
                    userId: a.userId,
                    name: a.name || a.email || "Unknown",
                    activities: count,
                };
            }
        }

        const disputeTrendByDate = new Map<
            string,
            { created: number; closed: number }
        >();
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

        return serializeBigInt({
            aggregate: {
                activities: {
                    manual,
                    automated,
                    byType,
                    delivered,
                    failed,
                    successRate:
                        activities.length > 0
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
                    successRate:
                        calls.length > 0
                            ? (successfulCalls / calls.length) * 100
                            : 0,
                    byOutcome: {},
                },
                promises: {
                    total: openPromisePeriods.length,
                    fulfilled: fulfilledPromises,
                    fulfillmentRate:
                        openPromisePeriods.length > 0
                            ? (fulfilledPromises /
                                  (openPromisePeriods.length +
                                      fulfilledPromises)) *
                              100
                            : 0,
                    totalAmount: promiseAmount,
                },
                productivity: {
                    averageActivitiesPerAgent:
                        agentIds.length > 0
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
                    system: activities.filter(
                        (a) => a.created_by === systemUserId
                    ).length,
                    portal: activities.filter(
                        (a) => a.created_by === portalUserId
                    ).length,
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
                created: sortedDates.map(
                    (d) => disputeTrendByDate.get(d)?.created || 0
                ),
                closed: sortedDates.map(
                    (d) => disputeTrendByDate.get(d)?.closed || 0
                ),
            },
            fromCache: false,
        });
    }

    async getOperationDashboardDetails(
        _user: JwtPayload,
        _query: SystemListQuery = {}
    ) {
        return serializeBigInt({
            data: [],
            totalRecords: 0,
            hasMore: false,
        });
    }

    /** Customer fields the Agents grids need (country/state/BU + display names). */
    private agentsCustomerSelect() {
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

    async getAgents(user: JwtPayload, query: SystemListQuery = {}) {
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
            current_category: "Agent" as const,
            period_end_date: null,
            ...(outcome ? { last_call_result: outcome } : {}),
            Customer: {
                account_id: accountId,
                collection_status: "Active" as const,
                ...(Number.isFinite(businessUnitId)
                    ? { business_unit_id: businessUnitId }
                    : {}),
                ...(search
                    ? {
                          OR: [
                              {
                                  customer_number: {
                                      contains: search,
                                      mode: "insensitive" as const,
                                  },
                              },
                              {
                                  Company: {
                                      name: {
                                          contains: search,
                                          mode: "insensitive" as const,
                                      },
                                  },
                              },
                              {
                                  Person: {
                                      first_name: {
                                          contains: search,
                                          mode: "insensitive" as const,
                                      },
                                  },
                              },
                              {
                                  Person: {
                                      last_name: {
                                          contains: search,
                                          mode: "insensitive" as const,
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

        return serializeBigInt({
            agents: periods,
            totalRecords,
            currentPage: page,
            totalPages: Math.ceil(totalRecords / limit) || 0,
            currency,
        });
    }

    async getAgentsFollowUp(user: JwtPayload) {
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
        return serializeBigInt({
            agents: periods,
            followUps: periods,
            totalRecords: periods.length,
            currency,
        });
    }

    async getAgentsStats(user: JwtPayload, query: SystemListQuery = {}) {
        const { accountId } = await this.scope(user);
        const currency = await this.accountCurrency(accountId);
        const search = query.search || "";
        const outcome = query.outcome || "";
        const businessUnitId = query.businessUnitId
            ? parseInt(String(query.businessUnitId), 10)
            : NaN;

        const where = {
            current_category: "Agent" as const,
            period_end_date: null,
            ...(outcome ? { last_call_result: outcome } : {}),
            Customer: {
                account_id: accountId,
                collection_status: "Active" as const,
                ...(Number.isFinite(businessUnitId)
                    ? { business_unit_id: businessUnitId }
                    : {}),
                ...(search
                    ? {
                          OR: [
                              {
                                  customer_number: {
                                      contains: search,
                                      mode: "insensitive" as const,
                                  },
                              },
                              {
                                  Company: {
                                      name: {
                                          contains: search,
                                          mode: "insensitive" as const,
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
            ...new Set(
                periods
                    .map((p) => p.customer_id)
                    .filter((id): id is number => id != null)
            ),
        ];
        const totalInvoices =
            customerIds.length === 0
                ? 0
                : await this.db.invoice.count({
                      where: {
                          customer_id: { in: customerIds },
                          status: { notIn: ["Paid", "Void", "Cancelled"] },
                          due_date: { lt: new Date() },
                      },
                  });

        return serializeBigInt({
            stats: {
                counts: {
                    total_customers: totalCustomers,
                    total_invoices: totalInvoices,
                    total_outstanding_amount: Number(
                        totalOutstanding._sum.total_outstanding_amount ?? 0
                    ),
                    currency,
                },
            },
            // Keep legacy keys for any older consumers
            totalAgents: totalCustomers,
            totalOutstandingAmount: Number(
                totalOutstanding._sum.total_outstanding_amount ?? 0
            ),
        });
    }

    async getPromiseToPay(user: JwtPayload, query: SystemListQuery = {}) {
        const { accountId } = await this.scope(user);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const search = query.search || "";
        const skip = (page - 1) * limit;

        const where = {
            current_category: "Promise_to_pay" as const,
            period_end_date: null,
            Customer: {
                account_id: accountId,
                collection_status: "Active" as const,
                ...(search
                    ? {
                          OR: [
                              {
                                  customer_number: {
                                      contains: search,
                                      mode: "insensitive" as const,
                                  },
                              },
                              {
                                  Company: {
                                      name: {
                                          contains: search,
                                          mode: "insensitive" as const,
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

        return serializeBigInt({ promiseToPayList, totalRecords });
    }

    async getPromiseToPayStats(user: JwtPayload) {
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
        return serializeBigInt({
            total: count,
            totalPromiseAmount: Number(agg._sum.promise_to_pay_amount ?? 0),
            totalOutstandingAmount: Number(
                agg._sum.total_outstanding_amount ?? 0
            ),
        });
    }

    async postPromiseToPay(
        _user: JwtPayload,
        body: Record<string, unknown>
    ) {
        return serializeBigInt({
            success: true,
            message: "Promise-to-pay acknowledged",
            body,
        });
    }

    async getCronJobs(_user: JwtPayload) {
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
            return serializeBigInt({
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
        } catch {
            return { cronJobs: [], message: "CronJob model unavailable" };
        }
    }

    async postCronJobs(
        _user: JwtPayload,
        body: Record<string, unknown> = {}
    ) {
        return {
            success: true,
            message: "Cron trigger acknowledged (Nest stub — no runner)",
            timestamp: new Date().toISOString(),
            body,
        };
    }

    async cacheInvalidation(body: Record<string, unknown>) {
        const source = body.source;
        const reason = body.reason;
        if (!source || source !== "cron-job") {
            throw new BadRequestException({
                error: "Invalid source or missing source",
            });
        }
        if (!reason) {
            throw new BadRequestException({
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

    async getSharedStats(user: JwtPayload, operation: string) {
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
                    total_overdue_amount: Number(
                        overdue._sum.outstanding_debt ?? 0
                    ),
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
                throw new NotFoundException({
                    error: `Unknown shared-stats operation: ${operation}`,
                });
        }
    }
}
