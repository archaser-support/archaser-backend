import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import { InvoicesService } from "../invoices/invoices.service";
import { CronQueueService } from "../queue/cron-queue.service";
import {
    buildActiveCustomersChart,
    buildAgingRangeRows,
    buildAudienceReportChart,
    buildAutomatedPhaseSplitChart,
    buildCollectionEffortsPhase,
    buildCollectionStat,
    buildMaturityRows,
    buildTopEntityAmounts,
    reconstructDashboardFromCache,
    type EntityAmount,
} from "./financial-dashboard.builder";
import { followUpTimeWhere } from "./agents-follow-up-date-range";

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

const DUE_CHART_TYPES = [
    "total-due",
    "due-today",
    "due-this-week",
    "due-this-month",
    "due-next-month",
] as const;

const COLLECTED_MTD_CHART_TYPES = [
    "collected-mtd",
    "collected-vs-promise",
] as const;

/** Future due-date buckets matching MATURITY_DAYS_RANGE_MAP on the web side. */
const MATURITY_BUCKETS = [
    { daysRange: "0-7 days", min: 0, max: 7 },
    { daysRange: "8-30 days", min: 8, max: 30 },
    { daysRange: "31-60 days", min: 31, max: 60 },
    { daysRange: "61-90 days", min: 61, max: 90 },
    { daysRange: "91-180 days", min: 91, max: 180 },
    { daysRange: "181-365 days", min: 181, max: 365 },
    { daysRange: "365 days+", min: 366, max: 9999 },
] as const;

export type SystemListQuery = Record<string, string | undefined>;

@Injectable()
export class SystemService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService,
        private readonly cronQueue: CronQueueService,
        private readonly invoices: InvoicesService
    ) {}

    private async scope(user: JwtPayload) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        return { userInfo, accountId };
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

    /**
     * Top-10 amount slices by customer and by business unit for one invoice
     * scope. Both charts are derived from the same grouped rows so a customer's
     * amount can never disagree with the unit it rolls up into. Customers with
     * no business unit are left out of the unit chart rather than bucketed into
     * a synthetic "unassigned" slice.
     */
    private async buildEntityBreakdowns(
        accountId: number,
        invoiceWhere: Prisma.InvoiceWhereInput
    ): Promise<{
        byCustomer: EntityAmount[];
        byBusinessUnit: EntityAmount[];
    }> {
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
            .filter((id): id is number => id != null);
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

        const customerEntries: Array<{ label: string; amount: number }> = [];
        const unitTotals = new Map<number, { label: string; amount: number }>();

        for (const group of groups) {
            const amount = Number(group._sum?.outstanding_debt ?? 0);
            if (group.customer_id == null || amount <= 0) {
                continue;
            }
            const customer = byId.get(group.customer_id);
            customerEntries.push({
                label:
                    customer?.Person?.full_name ||
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
            } else {
                unitTotals.set(unit.id, {
                    label: unit.name || `#${unit.id}`,
                    amount,
                });
            }
        }

        return {
            byCustomer: buildTopEntityAmounts(customerEntries),
            byBusinessUnit: buildTopEntityAmounts([...unitTotals.values()]),
        };
    }

    /**
     * Due-tab counterpart of the aging table: still-open invoices bucketed by
     * how many days remain until they fall due.
     */
    private async buildReceivablesMaturitySchedule(accountId: number) {
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
                const days = Math.floor(
                    (invoice.due_date.getTime() - today.getTime()) /
                        (1000 * 60 * 60 * 24)
                );
                return days >= range.min && days <= range.max;
            });
            const customers = new Set(
                inRange
                    .map((invoice) => invoice.customer_id)
                    .filter((id): id is number => id != null)
            );
            return {
                daysRange: range.daysRange,
                invoices: inRange.length,
                accounts: customers.size,
                amount: inRange.reduce(
                    (sum, invoice) => sum + Number(invoice.outstanding_debt ?? 0),
                    0
                ),
            };
        });

        return buildMaturityRows(buckets);
    }

    /**
     * Customers gained vs lost per month. "Removed" leans on `modified_at`
     * because deactivation is not journalled anywhere — a customer edited after
     * being deactivated counts in the month of that later edit.
     */
    private async buildActiveCustomersSeries(accountId: number) {
        const now = new Date();
        const added: number[] = [];
        const removed: number[] = [];

        for (let i = 5; i >= 0; i--) {
            const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthEnd = new Date(
                now.getFullYear(),
                now.getMonth() - i + 1,
                0,
                23,
                59,
                59,
                999
            );
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

        return buildActiveCustomersChart(added, removed, now);
    }

    /** Where active automated collection periods sit in the step sequence. */
    private async buildAutomatedPhaseSplit(accountId: number) {
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

        return buildAutomatedPhaseSplitChart(steps);
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
            overdueByEntity,
            dueByEntity,
            receivablesMaturitySchedule,
            activeCustomersChart,
            automatedPhaseSplit,
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

    private resolveMaturityBucket(daysRange?: string | null) {
        if (!daysRange) {
            return null;
        }
        const normalized = daysRange.replace(/\+(?!$)/g, " ").trim();
        return (
            MATURITY_BUCKETS.find((b) => b.daysRange === normalized) ??
            MATURITY_BUCKETS.find(
                (b) =>
                    b.daysRange.replace(/ /g, "") ===
                    normalized.replace(/ /g, "")
            ) ??
            null
        );
    }

    private parseYearMonth(
        period?: string | null
    ): { year: number; monthIndex: number } | null {
        if (!period || !/^\d{4}-\d{2}/.test(period)) {
            return null;
        }
        const [yearStr, monthStr] = period.split("-");
        const year = parseInt(yearStr, 10);
        const monthIndex = parseInt(monthStr, 10) - 1;
        if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
            return null;
        }
        return { year, monthIndex };
    }

    private utcMonthRange(
        year: number,
        monthIndex: number
    ): { start: Date; end: Date } {
        const start = this.startOfUtcDay(
            new Date(Date.UTC(year, monthIndex, 1))
        );
        const end = this.endOfUtcDay(
            new Date(Date.UTC(year, monthIndex + 1, 0))
        );
        return { start, end };
    }

    private dueDateFilterForChart(
        type: string,
        today: Date,
        daysRange?: string | null
    ): Record<string, Date> | null {
        if (type === "due-today") {
            return { gte: today, lte: this.endOfUtcDay(today) };
        }
        if (type === "due-this-week") {
            const weekStart = this.addDays(today, -today.getUTCDay());
            const lastInclusive = this.addDays(weekStart, 6);
            return { gte: today, lte: this.endOfUtcDay(lastInclusive) };
        }
        if (type === "due-this-month") {
            const end = this.endOfUtcDay(
                new Date(
                    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
                )
            );
            return { gte: today, lte: end };
        }
        if (type === "due-next-month") {
            return {
                gte: this.startOfUtcDay(
                    new Date(
                        Date.UTC(
                            today.getUTCFullYear(),
                            today.getUTCMonth() + 1,
                            1
                        )
                    )
                ),
                lte: this.endOfUtcDay(
                    new Date(
                        Date.UTC(
                            today.getUTCFullYear(),
                            today.getUTCMonth() + 2,
                            0
                        )
                    )
                ),
            };
        }
        if (type === "receivables-maturity-schedule") {
            const bucket = this.resolveMaturityBucket(daysRange);
            if (!bucket) {
                return { gte: today };
            }
            return {
                gte: this.startOfUtcDay(this.addDays(today, bucket.min)),
                lte: this.endOfUtcDay(this.addDays(today, bucket.max)),
            };
        }
        return null;
    }

    private customerDisplayName(customer: {
        customer_number?: string | null;
        Company?: { name?: string | null } | null;
        Person?: {
            first_name?: string | null;
            last_name?: string | null;
        } | null;
    }): string {
        const company = customer.Company?.name?.trim();
        if (company) {
            return company;
        }
        const person = [customer.Person?.first_name, customer.Person?.last_name]
            .filter(Boolean)
            .join(" ")
            .trim();
        return person || customer.customer_number || "";
    }

    private async chartDetailsEnvelope(
        accountId: number,
        summary: Record<string, number>,
        data: unknown[] = []
    ) {
        const currency = await this.accountCurrency(accountId);
        return serializeBigInt({
            details: [],
            data,
            totalRecords: summary.totalRecords ?? data.length,
            summary,
            currency,
        });
    }

    private async invoiceChartSummary(where: Record<string, unknown>) {
        const [totalRecords, amountAgg] = await Promise.all([
            this.db.invoice.count({ where }),
            this.db.invoice.aggregate({
                where,
                _sum: {
                    outstanding_debt: true,
                    customer_outstanding_debt: true,
                },
            }),
        ]);
        const outstanding = Number(amountAgg._sum.outstanding_debt ?? 0);
        const customerOutstanding = Number(
            amountAgg._sum.customer_outstanding_debt ?? 0
        );
        return {
            totalRecords,
            totalAmount: outstanding || customerOutstanding,
        };
    }

    async getChartDetails(user: JwtPayload, query: SystemListQuery = {}) {
        const { userInfo, accountId } = await this.scope(user);

        const accessWhere =
            await this.accessScope.buildCustomerAccessWhere(userInfo);
        const selectedBu = await this.selectedBusinessUnitFilter(query);
        const today = this.startOfUtcDay(new Date());

        // Invoice-shaped overdue / aging drill-downs. Rows come from the
        // dashboard_invoices report, so only summary cards are served here.
        if (
            query.type === "aging-portfolio" ||
            query.type === "overdue-invoices"
        ) {
            const bucket =
                query.type === "aging-portfolio"
                    ? this.resolveAgingBucket(query.daysRange)
                    : null;
            const customerScope = [
                ...accessWhere,
                { collection_status: "Active" as const },
            ];
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
            const summary = await this.invoiceChartSummary(where);
            return this.chartDetailsEnvelope(accountId, summary);
        }

        // Due-family and maturity buckets share Due + outstanding membership
        // with the dashboard_invoices_due locked filters.
        const isDueFamily = (
            DUE_CHART_TYPES as readonly string[]
        ).includes(query.type || "");
        const isMaturityInvoiceList =
            query.type === "receivables-maturity-schedule" &&
            !!this.resolveMaturityBucket(query.daysRange);
        if (isDueFamily || isMaturityInvoiceList) {
            const customerScope = [
                ...accessWhere,
                { collection_status: { in: ["Active", "Inactive"] as const } },
            ];
            if (selectedBu) {
                customerScope.push(
                    selectedBu as (typeof customerScope)[number]
                );
            }
            const dueDate = this.dueDateFilterForChart(
                query.type || "",
                today,
                query.daysRange
            );
            const where = {
                account_id: accountId,
                status: "Due" as const,
                customer_outstanding_debt: { gt: 0 },
                Customer: { AND: customerScope },
                ...(dueDate ? { due_date: dueDate } : {}),
            };
            const summary = await this.invoiceChartSummary(where);
            return this.chartDetailsEnvelope(accountId, summary);
        }

        // The overdue customer drills render rows from dashboard_customers.
        if (
            query.type === "overdue-amount" ||
            query.type === "overdue-customers"
        ) {
            const periodFilter = this.openCollectionPeriodFilter();
            const customerScope = [...accessWhere];
            if (selectedBu) {
                customerScope.push(selectedBu);
            }
            const [totalRecords, amountAgg] = await Promise.all([
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
            ]);
            return this.chartDetailsEnvelope(accountId, {
                totalRecords,
                totalAmount: Number(
                    amountAgg._sum.total_outstanding_amount ?? 0
                ),
            });
        }

        if (
            (
                COLLECTED_MTD_CHART_TYPES as readonly string[]
            ).includes(query.type || "")
        ) {
            const parsed = this.parseYearMonth(query.period);
            if (parsed) {
                const { start, end } = this.utcMonthRange(
                    parsed.year,
                    parsed.monthIndex
                );
                const where = {
                    account_id: accountId,
                    payment_date: { gte: start, lte: end },
                    ...LINKED_PAYMENT,
                };
                const [totalRecords, amountAgg] = await Promise.all([
                    this.db.invoicePayment.count({ where }),
                    this.db.invoicePayment.aggregate({
                        where,
                        _sum: { amount: true },
                    }),
                ]);
                const totalAmount = Number(amountAgg._sum.amount ?? 0);
                return this.chartDetailsEnvelope(accountId, {
                    totalRecords,
                    totalAmount,
                    totalCollectedRecords: totalRecords,
                });
            }
        }

        if (query.type === "active-customers") {
            const parsed = this.parseYearMonth(query.period);
            if (parsed) {
                const now = new Date();
                let year = parsed.year;
                if (
                    year > now.getUTCFullYear() ||
                    (year === now.getUTCFullYear() &&
                        parsed.monthIndex > now.getUTCMonth())
                ) {
                    year -= 1;
                }
                const { start, end } = this.utcMonthRange(
                    year,
                    parsed.monthIndex
                );
                const enteredWhere = {
                    AND: [
                        ...accessWhere,
                        { collection_status: "Active" as const },
                        { created_at: { gte: start, lte: end } },
                        ...(selectedBu ? [selectedBu] : []),
                    ],
                };
                const exitedWhere = {
                    AND: [
                        ...accessWhere,
                        { collection_status: "Inactive" as const },
                        { modified_at: { gte: start, lte: end } },
                    ],
                };
                const [enteredCount, exitedCount] = await Promise.all([
                    this.db.customer.count({ where: enteredWhere }),
                    this.db.customer.count({ where: exitedWhere }),
                ]);
                return this.chartDetailsEnvelope(accountId, {
                    totalRecords: enteredCount + exitedCount,
                    totalAmount: 0,
                    enteredCount,
                    exitedCount,
                });
            }
        }

        if (
            query.type === "collection-efforts" ||
            query.type === "automated-phase-split"
        ) {
            const customerScope = [
                ...accessWhere,
                { collection_status: "Active" as const },
            ];
            if (selectedBu) {
                customerScope.push(
                    selectedBu as (typeof customerScope)[number]
                );
            }
            const periodWhere = {
                period_end_date: null,
                total_outstanding_amount: { gt: 0 },
                Customer: { AND: customerScope },
                ...(query.type === "automated-phase-split"
                    ? { current_category: "Automated" as const }
                    : {}),
            };
            const [totalRecords, amountAgg, invoiceAgg, periods] =
                await Promise.all([
                    this.db.customerCollectionPeriod.count({
                        where: periodWhere,
                    }),
                    this.db.customerCollectionPeriod.aggregate({
                        where: periodWhere,
                        _sum: { total_outstanding_amount: true },
                    }),
                    this.db.customerCollectionPeriod.aggregate({
                        where: periodWhere,
                        _sum: { no_of_overdue_invoices: true },
                    }),
                    this.db.customerCollectionPeriod.findMany({
                        where: periodWhere,
                        take: 20000,
                        include: {
                            Customer: {
                                select: {
                                    id: true,
                                    customer_number: true,
                                    Company: { select: { name: true } },
                                    Person: {
                                        select: {
                                            first_name: true,
                                            last_name: true,
                                        },
                                    },
                                    Owner: {
                                        select: {
                                            name: true,
                                            first_name: true,
                                            last_name: true,
                                        },
                                    },
                                },
                            },
                        },
                    }),
                ]);
            const data = periods.map((period) => {
                const owner = period.Customer?.Owner;
                const assignedAgent =
                    owner?.name ||
                    [owner?.first_name, owner?.last_name]
                        .filter(Boolean)
                        .join(" ") ||
                    "";
                return {
                    accountId: period.Customer?.customer_number || "",
                    customerName: this.customerDisplayName(
                        period.Customer || {}
                    ),
                    outstandingAmount: Number(
                        period.total_outstanding_amount ?? 0
                    ),
                    promiseToPayAmount: Number(
                        period.promise_to_pay_amount ?? 0
                    ),
                    invoiceCount: Number(period.no_of_overdue_invoices ?? 0),
                    lastActivity: period.last_call,
                    date: period.period_start_date,
                    phase: period.current_category || "",
                    assignedAgent,
                    customerCurrency: period.currency,
                };
            });
            return this.chartDetailsEnvelope(
                accountId,
                {
                    totalRecords,
                    totalAmount: Number(
                        amountAgg._sum.total_outstanding_amount ?? 0
                    ),
                    totalInvoiceCount: Number(
                        invoiceAgg._sum.no_of_overdue_invoices ?? 0
                    ),
                },
                data
            );
        }

        // UI always reads `data` + `summary` (+ optional `currency`). Keep the
        // legacy `details` key empty for older callers; do not return a bare
        // `{ details, totalRecords }` stub that leaves the chart-details page empty.
        return this.chartDetailsEnvelope(accountId, {
            totalRecords: 0,
            totalAmount: 0,
        });
    }

    async getControlCenter(
        user: JwtPayload,
        operation?: string | null,
        query: SystemListQuery = {}
    ) {
        const { accountId } = await this.scope(user);
        const op = operation || "stats";

        if (op === "stats" || op === "agents") {
            return this.controlCenterStats(accountId);
        }
        if (op === "customers-without-contact") {
            return this.listControlCenterCustomers(accountId, query, {
                Contact: { none: {} },
            });
        }
        if (op === "customers-with-invalid-contact") {
            return this.listControlCenterCustomers(accountId, query, {
                Contact: { some: this.invalidContactWhere() },
            });
        }
        if (op === "invoices-without-customer") {
            return this.listControlCenterInvoices(accountId, query, {
                customer_id: null,
            });
        }
        if (op === "orphan-credit-invoices") {
            return this.listControlCenterInvoices(accountId, query, {
                amount: { lt: 0 },
                credit_for_invoice_id: null,
            });
        }

        throw new NotFoundException({
            error: "Control center endpoint not found",
        });
    }

    private invalidContactWhere() {
        return {
            OR: [
                { email_status: { in: ["Bounced", "Failure"] as const } },
                { email_bounce_count: { gt: 0 } },
                { last_email_bounce: { not: null } },
            ],
        };
    }

    private closedInvoiceStatuses() {
        return ["Paid", "Void", "Cancelled"] as const;
    }

    private async countByCollectionStatus(
        accountId: number,
        extraWhere: Record<string, unknown>
    ) {
        const [active, inactive] = await Promise.all([
            this.db.customer.count({
                where: {
                    account_id: accountId,
                    collection_status: "Active",
                    ...extraWhere,
                },
            }),
            this.db.customer.count({
                where: {
                    account_id: accountId,
                    collection_status: { not: "Active" },
                    ...extraWhere,
                },
            }),
        ]);
        return { active, inactive };
    }

    private async countInvoicesByClosedStatus(
        accountId: number,
        extraWhere: Record<string, unknown>
    ) {
        const closed = [...this.closedInvoiceStatuses()];
        const [active, inactive] = await Promise.all([
            this.db.invoice.count({
                where: {
                    account_id: accountId,
                    status: { notIn: closed },
                    ...extraWhere,
                },
            }),
            this.db.invoice.count({
                where: {
                    account_id: accountId,
                    status: { in: closed },
                    ...extraWhere,
                },
            }),
        ]);
        return { active, inactive };
    }

    private async controlCenterStats(accountId: number) {
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

        const [
            activeCustomers,
            overdueInvoices,
            openDisputes,
            noContacts,
            invalidContacts,
            invoicesWithoutCustomer,
            orphanCreditInvoices,
        ] = await Promise.all([
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
            this.countByCollectionStatus(accountId, {
                Contact: { none: {} },
            }),
            this.countByCollectionStatus(accountId, {
                Contact: { some: this.invalidContactWhere() },
            }),
            this.countInvoicesByClosedStatus(accountId, {
                customer_id: null,
            }),
            this.countInvoicesByClosedStatus(accountId, {
                amount: { lt: 0 },
                credit_for_invoice_id: null,
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
            noContacts,
            invalidContacts,
            invoicesWithoutCustomer,
            orphanCreditInvoices,
        });
    }

    private controlCenterPage(query: SystemListQuery) {
        const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
        const limit = Math.min(
            10000,
            Math.max(1, parseInt(query.limit || "25", 10) || 25)
        );
        return { page, limit, skip: (page - 1) * limit };
    }

    private controlCenterCustomerInclude() {
        return {
            Person: { select: { first_name: true, last_name: true } },
            Company: { select: { name: true } },
            CustomerCollectionPeriod: {
                where: { period_end_date: null },
                take: 1,
                orderBy: { id: "desc" as const },
                select: {
                    current_category: true,
                    total_outstanding_amount: true,
                    currency: true,
                    no_of_overdue_invoices: true,
                },
            },
        };
    }

    private async listControlCenterCustomers(
        accountId: number,
        query: SystemListQuery,
        extraWhere: Record<string, unknown>
    ) {
        const { page, limit, skip } = this.controlCenterPage(query);
        const search = query.query || query.search || "";
        const status = query.status;
        const selectedUserId = query.selectedUserId;
        const sortField = query.sortField || "customer_number";
        const sortDirection = query.sortDirection === "desc" ? "desc" : "asc";

        const where: Record<string, unknown> = {
            account_id: accountId,
            ...extraWhere,
            ...(status ? { collection_status: status } : {}),
            ...(selectedUserId ? { owner_id: selectedUserId } : {}),
        };
        if (search) {
            where.OR = [
                {
                    customer_number: {
                        contains: search,
                        mode: "insensitive",
                    },
                },
                {
                    Company: {
                        name: { contains: search, mode: "insensitive" },
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
            ];
        }

        const orderBy =
            sortField === "name"
                ? { Company: { name: sortDirection as "asc" | "desc" } }
                : sortField === "collection_status"
                  ? { collection_status: sortDirection as "asc" | "desc" }
                  : { customer_number: sortDirection as "asc" | "desc" };

        const [customers, totalRecords] = await Promise.all([
            this.db.customer.findMany({
                where,
                include: this.controlCenterCustomerInclude(),
                skip,
                take: limit,
                orderBy,
            }),
            this.db.customer.count({ where }),
        ]);

        return serializeBigInt({ customers, totalRecords, page, limit });
    }

    private async listControlCenterInvoices(
        accountId: number,
        query: SystemListQuery,
        extraWhere: Record<string, unknown>
    ) {
        const { page, limit, skip } = this.controlCenterPage(query);
        const search = query.query || query.search || "";
        const selectedUserId = query.selectedUserId;
        const sortField = query.sortField || "invoice_number";
        const sortDirection = query.sortDirection === "desc" ? "desc" : "asc";

        const where: Record<string, unknown> = {
            account_id: accountId,
            ...extraWhere,
        };
        if (search) {
            where.invoice_number = {
                contains: search,
                mode: "insensitive",
            };
        }
        if (selectedUserId) {
            where.Customer = { owner_id: selectedUserId };
        }

        const sortable = new Set([
            "invoice_number",
            "invoice_date",
            "amount",
            "status",
            "id",
        ]);
        const orderBy = {
            [sortable.has(sortField) ? sortField : "invoice_number"]:
                sortDirection,
        };

        const [invoices, totalRecords] = await Promise.all([
            this.db.invoice.findMany({
                where,
                select: {
                    id: true,
                    invoice_number: true,
                    invoice_date: true,
                    amount: true,
                    status: true,
                    customer_id: true,
                    Customer: {
                        select: {
                            id: true,
                            type: true,
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
                skip,
                take: limit,
                orderBy,
            }),
            this.db.invoice.count({ where }),
        ]);

        return serializeBigInt({ invoices, totalRecords, page, limit });
    }

    async postControlCenter(
        user: JwtPayload,
        operation: string | null | undefined,
        body: Record<string, unknown>
    ) {
        const op = operation || (body.operation as string | undefined);
        if (op === "assign-credit") {
            return this.invoices.assignCredit(user, {
                creditInvoiceId: Number(body.creditInvoiceId),
                targetInvoiceId: Number(body.targetInvoiceId),
                creditAmount:
                    body.creditAmount != null
                        ? Number(body.creditAmount)
                        : undefined,
            });
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

    async getAgentsFollowUp(user: JwtPayload, query: SystemListQuery = {}) {
        const { accountId } = await this.scope(user);
        const currency = await this.accountCurrency(accountId);
        const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
        const limit = Math.min(
            100,
            Math.max(1, parseInt(query.limit || "10", 10) || 10)
        );
        const skip = (page - 1) * limit;
        const search = (query.search || "").trim();
        const businessUnitId = query.businessUnitId
            ? parseInt(String(query.businessUnitId), 10)
            : NaN;
        const sortDirection =
            String(query.sortDirection || "asc").toLowerCase() === "desc"
                ? "desc"
                : "asc";

        const reminderWindowMinutes = query.reminderWindowMinutes
            ? parseInt(String(query.reminderWindowMinutes), 10)
            : NaN;
        const reminderOverdueMinutes = query.reminderOverdueMinutes
            ? parseInt(String(query.reminderOverdueMinutes), 10)
            : NaN;
        const isReminderPoll =
            Number.isFinite(reminderWindowMinutes) ||
            Number.isFinite(reminderOverdueMinutes);

        let followUpTimeFilter: ReturnType<typeof followUpTimeWhere> | {
            not: null;
            gte: Date;
            lte: Date;
        };
        if (isReminderPoll) {
            const now = new Date();
            const overdueMs =
                (Number.isFinite(reminderOverdueMinutes)
                    ? reminderOverdueMinutes
                    : 24 * 60) *
                60 *
                1000;
            const windowMs =
                (Number.isFinite(reminderWindowMinutes)
                    ? reminderWindowMinutes
                    : 10) *
                60 *
                1000;
            followUpTimeFilter = {
                not: null,
                gte: new Date(now.getTime() - overdueMs),
                lte: new Date(now.getTime() + windowMs),
            };
        } else {
            followUpTimeFilter = followUpTimeWhere(query.followUpDateRange);
        }

        const where = {
            follow_up_time: followUpTimeFilter,
            period_end_date: null,
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
                orderBy: { follow_up_time: sortDirection },
            }),
            this.db.customerCollectionPeriod.count({ where }),
        ]);

        return serializeBigInt({
            agents: periods,
            followUps: periods,
            totalRecords,
            currentPage: page,
            totalPages: Math.ceil(totalRecords / limit) || 0,
            currency,
        });
    }

    async clearAgentsFollowUp(
        user: JwtPayload,
        body: Record<string, unknown>
    ) {
        const { accountId } = await this.scope(user);
        const id = parseInt(String(body.id ?? ""), 10);
        if (!Number.isFinite(id)) {
            throw new BadRequestException({ error: "id is required" });
        }

        const period = await this.db.customerCollectionPeriod.findFirst({
            where: {
                id,
                Customer: { account_id: accountId },
            },
            select: { id: true },
        });
        if (!period) {
            throw new NotFoundException({
                error: "Collection period not found",
            });
        }

        await this.db.customerCollectionPeriod.update({
            where: { id: period.id },
            data: { follow_up_time: null },
        });

        return { success: true, id: period.id };
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
        const currency = await this.accountCurrency(accountId);
        const where = {
            current_category: "Promise_to_pay" as const,
            period_end_date: null,
            Customer: {
                account_id: accountId,
                collection_status: "Active" as const,
            },
        };
        const [count, agg] = await Promise.all([
            this.db.customerCollectionPeriod.count({ where }),
            this.db.customerCollectionPeriod.aggregate({
                where,
                _sum: {
                    promise_to_pay_amount: true,
                    total_outstanding_amount: true,
                    no_of_overdue_invoices: true,
                },
            }),
        ]);
        const totalOutstandingAmount = Number(
            agg._sum.total_outstanding_amount ?? 0
        );
        const totalInvoices = Number(agg._sum.no_of_overdue_invoices ?? 0);
        return serializeBigInt({
            stats: {
                counts: {
                    total_customers: count,
                    total_invoices: totalInvoices,
                    total_outstanding_amount: totalOutstandingAmount,
                    currency,
                },
            },
            total: count,
            totalPromiseAmount: Number(agg._sum.promise_to_pay_amount ?? 0),
            totalOutstandingAmount,
        });
    }

    async postPromiseToPay(
        user: JwtPayload,
        body: Record<string, unknown>
    ) {
        const { accountId } = await this.scope(user);
        const customerId = parseInt(String(body.customer_id ?? ""), 10);
        if (!Number.isFinite(customerId)) {
            throw new BadRequestException({ error: "customer_id is required" });
        }

        const raw = String(body.promise_to_pay_date ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            throw new BadRequestException({
                error: "promise_to_pay_date must be YYYY-MM-DD",
            });
        }
        const promiseDate = new Date(`${raw}T00:00:00.000Z`);
        if (Number.isNaN(promiseDate.getTime())) {
            throw new BadRequestException({
                error: "promise_to_pay_date is not a valid date",
            });
        }

        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: {
                id: true,
                account_id: true,
                Account: {
                    select: { max_promise_to_pay_allowed_per_cycle: true },
                },
            },
        });
        if (!customer) {
            throw new NotFoundException({ error: "Customer not found" });
        }

        const collection = await this.db.customerCollectionPeriod.findFirst({
            where: { customer_id: customer.id, period_end_date: null },
            select: { id: true, promise_to_pay_count: true },
            orderBy: { id: "desc" },
        });
        if (!collection) {
            throw new BadRequestException({
                error: "Customer has no open collection period",
            });
        }

        const cap =
            customer.Account?.max_promise_to_pay_allowed_per_cycle ?? 0;
        if (cap > 0 && (collection.promise_to_pay_count ?? 0) >= cap) {
            throw new BadRequestException({
                error: "Promise to pay limit reached for this collection period",
            });
        }

        const comment = String(body.comment ?? "");
        const userInfo = await this.accessScope.resolveUserInfo(user);

        await this.db.$transaction(async (tx) => {
            await tx.customerCollectionPeriod.update({
                where: { id: collection.id },
                data: {
                    promise_to_pay_date: promiseDate,
                    promise_to_pay_count: { increment: 1 },
                } as never,
            });
            await tx.activity.create({
                data: {
                    customer_id: customer.id,
                    account_id: customer.account_id,
                    type: "Promise_to_pay",
                    status: "COMPLETED",
                    title: "{{activities.fields.activity_promise_to_pay}}",
                    title_params: {
                        userId: userInfo.userId,
                        date: raw,
                    },
                    content: comment,
                    collection_period_id: collection.id,
                    created_by: userInfo.userId,
                    modified_by: userInfo.userId,
                } as never,
            });
        });

        return serializeBigInt({
            success: true,
            customer_id: customer.id,
            promise_to_pay_date: promiseDate,
            promise_to_pay_count: (collection.promise_to_pay_count ?? 0) + 1,
        });
    }


    /**
     * AWS Lambda / external scheduler entry (GET|POST /api/system/cron).
     * Auth is CronSecretGuard (`x-cron-secret`). Matches monolith ENABLE_CRON_JOBS gate.
     * When enabled, nudges the BullMQ worker to resync repeatable schedules.
     */
    async runCronFromLambda() {
        if (process.env.ENABLE_CRON_JOBS !== "true") {
            return {
                success: true,
                message: "Cron jobs are disabled",
                result: null,
            };
        }
        try {
            const sync = await this.cronQueue.enqueueSyncSchedules({
                reason: "lambda-cron-tick",
            });
            return {
                success: true,
                message: "Cron jobs executed successfully",
                result: { sync },
            };
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Failed to execute cron jobs: ${message}`,
            };
        }
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
                    created_at: job.created_at,
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
        return this.triggerCronJob(_user, body);
    }

    async triggerCronJob(user: JwtPayload, body: Record<string, unknown> = {}) {
        const { userInfo } = await this.scope(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new ForbiddenException({
                error: "Forbidden - Access restricted to account 10013",
            });
        }
        const jobId =
            body.jobId != null ? Number(body.jobId) : undefined;
        if (jobId != null && Number.isFinite(jobId)) {
            const job = await this.db.cronJob.findUnique({
                where: { id: jobId },
                select: { id: true, name: true, active: true },
            });
            if (!job) {
                throw new NotFoundException({ error: "Cron job not found" });
            }
            const executionId = `ack-${job.id}-${Date.now()}`;
            const timestamp = new Date().toISOString();
            return {
                success: true,
                message: `Cron job ${job.name} trigger acknowledged`,
                jobId: job.id,
                timestamp,
                data: { executionId },
                result: {
                    steps: [
                        {
                            timestamp,
                            level: "INFO",
                            stepNumber: 1,
                            message: `Cron job ${job.name} trigger acknowledged`,
                        },
                    ],
                },
            };
        }
        const timestamp = new Date().toISOString();
        return {
            success: true,
            message: "Cron trigger acknowledged (all due)",
            timestamp,
            body,
            data: { executionId: `ack-all-${Date.now()}` },
            result: {
                steps: [
                    {
                        timestamp,
                        level: "INFO",
                        stepNumber: 1,
                        message: "Cron trigger acknowledged (all due)",
                    },
                ],
            },
        };
    }

    async getCronJobLogs(user: JwtPayload, executionId: string) {
        const { userInfo } = await this.scope(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new ForbiddenException({
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
        return serializeBigInt({
            executionId,
            status: logs.length ? "completed" : "unknown",
            items: logs,
            data: {
                logs: logs.map((log) => ({
                    ...log,
                    created_at: log.timestamp,
                    createdAt: log.timestamp,
                })),
            },
        });
    }

    async getAdminDashboard(user: JwtPayload) {
        const { userInfo } = await this.scope(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new ForbiddenException({
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
        return serializeBigInt({
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

    async getSystemHealth(user: JwtPayload) {
        const { userInfo } = await this.scope(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new ForbiddenException({
                error: "Forbidden - Access restricted to account 10013",
            });
        }

        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
        const twentyFourHoursAgo = new Date(
            now.getTime() - 24 * 60 * 60 * 1000
        );
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const allCronJobs = await this.db.cronJob.findMany();
        const overdueJobs = allCronJobs.filter(
            (job) => job.next_run_at && job.next_run_at < now
        );
        const runningJobs = allCronJobs.filter((job) => job.active === true);
        const jobsNotRunIn24h = allCronJobs.filter(
            (job) => !job.last_run_at || job.last_run_at < twentyFourHoursAgo
        );
        const totalExecutions = allCronJobs.reduce(
            (sum, job) =>
                sum +
                (job.success_count_30d || 0) +
                (job.failure_count_30d || 0) +
                (job.timeout_count_30d || 0),
            0
        );
        const totalSuccesses = allCronJobs.reduce(
            (sum, job) => sum + (job.success_count_30d || 0),
            0
        );

        const cronJobs = {
            overview: {
                totalJobs: allCronJobs.length,
                overdueCount: overdueJobs.length,
                runningCount: runningJobs.length,
                notRunIn24hCount: jobsNotRunIn24h.length,
                overallSuccessRate:
                    totalExecutions > 0
                        ? (totalSuccesses / totalExecutions) * 100
                        : 0,
            },
            jobs: allCronJobs.map((job) => {
                const totalJobExecutions =
                    (job.success_count_30d || 0) +
                    (job.failure_count_30d || 0) +
                    (job.timeout_count_30d || 0);
                return {
                    id: job.id,
                    name: job.name,
                    lastRunAt: job.last_run_at?.toISOString() || null,
                    nextRunAt: job.next_run_at?.toISOString() || null,
                    lastExecutionDurationSeconds:
                        job.last_execution_duration_seconds,
                    averageExecutionDurationSeconds:
                        job.average_execution_duration_seconds,
                    minExecutionDurationSeconds:
                        job.min_execution_duration_seconds,
                    maxExecutionDurationSeconds:
                        job.max_execution_duration_seconds,
                    timeoutPeriodSeconds: job.timeout_period_seconds,
                    successRate30d:
                        totalJobExecutions > 0
                            ? ((job.success_count_30d || 0) /
                                  totalJobExecutions) *
                              100
                            : 0,
                    failureRate30d:
                        totalJobExecutions > 0
                            ? ((job.failure_count_30d || 0) /
                                  totalJobExecutions) *
                              100
                            : 0,
                    timeoutRate30d:
                        totalJobExecutions > 0
                            ? ((job.timeout_count_30d || 0) /
                                  totalJobExecutions) *
                              100
                            : 0,
                    lastSuccessAt: job.last_success_at?.toISOString() || null,
                    lastFailureAt: job.last_failure_at?.toISOString() || null,
                    lastTimeoutAt: job.last_timeout_at?.toISOString() || null,
                    performanceBaselineSeconds:
                        job.performance_baseline_seconds,
                    performanceDegradationAlertSentAt:
                        job.performance_degradation_alert_sent_at?.toISOString() ||
                        null,
                    active: job.active === true,
                };
            }),
        };

        const countActivity = async (
            type: "Email" | "SMS",
            since: Date,
            status?: string
        ) => {
            return this.db.activity.count({
                where: {
                    type,
                    created_at: { gte: since },
                    ...(status ? { status: status as never } : {}),
                },
            });
        };

        const [
            emailSent1h,
            emailSent6h,
            emailSent24h,
            emailGen1h,
            emailGen6h,
            emailGen24h,
            emailFail1h,
            emailFail6h,
            emailFail24h,
            smsSent1h,
            smsSent6h,
            smsSent24h,
            smsGen1h,
            smsGen6h,
            smsGen24h,
            smsFail1h,
            smsFail6h,
            smsFail24h,
        ] = await Promise.all([
            countActivity("Email", oneHourAgo, "COMPLETED"),
            countActivity("Email", sixHoursAgo, "COMPLETED"),
            countActivity("Email", twentyFourHoursAgo, "COMPLETED"),
            countActivity("Email", oneHourAgo),
            countActivity("Email", sixHoursAgo),
            countActivity("Email", twentyFourHoursAgo),
            countActivity("Email", oneHourAgo, "FAILED"),
            countActivity("Email", sixHoursAgo, "FAILED"),
            countActivity("Email", twentyFourHoursAgo, "FAILED"),
            countActivity("SMS", oneHourAgo, "COMPLETED"),
            countActivity("SMS", sixHoursAgo, "COMPLETED"),
            countActivity("SMS", twentyFourHoursAgo, "COMPLETED"),
            countActivity("SMS", oneHourAgo),
            countActivity("SMS", sixHoursAgo),
            countActivity("SMS", twentyFourHoursAgo),
            countActivity("SMS", oneHourAgo, "FAILED"),
            countActivity("SMS", sixHoursAgo, "FAILED"),
            countActivity("SMS", twentyFourHoursAgo, "FAILED"),
        ]);

        const stuckGrouped = await this.db.activity.groupBy({
            by: ["status_reason"],
            where: {
                status: { in: ["SCHEDULED", "SENT"] as never },
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

        const inWindow = (d: Date, since: Date) => d >= since;
        const jobs24h = importJobs.filter((j) =>
            inWindow(j.created_at, twentyFourHoursAgo)
        );
        const jobs7d = importJobs.filter((j) =>
            inWindow(j.created_at, sevenDaysAgo)
        );
        const pendingCount = importJobs.filter(
            (j) => j.status === "Pending" || j.status === "Processing"
        ).length;
        const stuckCount = importJobs.filter(
            (j) =>
                (j.status === "Pending" || j.status === "Processing") &&
                j.created_at < sixHoursAgo
        ).length;
        const completed = importJobs.filter((j) => j.status === "Completed");
        const failed = importJobs.filter((j) => j.status === "Failed");
        const overallSuccessRate =
            completed.length + failed.length > 0
                ? (completed.length / (completed.length + failed.length)) * 100
                : 0;

        const byTypeMap = new Map<
            string,
            {
                importType: string;
                count24h: number;
                count7d: number;
                count30d: number;
                totalRecords: number;
                successfulRecords: number;
                failedRecords: number;
                durations: number[];
            }
        >();
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
                durations: [] as number[],
            };
            entry.count30d += 1;
            if (inWindow(job.created_at, sevenDaysAgo)) entry.count7d += 1;
            if (inWindow(job.created_at, twentyFourHoursAgo)) entry.count24h += 1;
            entry.totalRecords += job.total_records || 0;
            entry.successfulRecords += job.successful_records || 0;
            entry.failedRecords += job.failed_records || 0;
            if (job.started_at && job.completed_at) {
                entry.durations.push(
                    (job.completed_at.getTime() - job.started_at.getTime()) /
                        1000
                );
            }
            byTypeMap.set(key, entry);
        }

        const byType = [...byTypeMap.values()].map((e) => {
            const successDenom = e.successfulRecords + e.failedRecords;
            const avgDurationSeconds =
                e.durations.length > 0
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
                successRate:
                    successDenom > 0
                        ? (e.successfulRecords / successDenom) * 100
                        : 0,
                avgDurationSeconds,
                recordsPerHour:
                    avgDurationSeconds && avgDurationSeconds > 0
                        ? (e.totalRecords / avgDurationSeconds) * 3600
                        : 0,
            };
        });

        return serializeBigInt({
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
                    total: stuckGrouped.reduce(
                        (s, g) => s + (g._count._all || 0),
                        0
                    ),
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

    async listCompanies(_user: JwtPayload) {
        const companies = await this.db.company.findMany({
            select: { id: true, name: true },
            orderBy: { name: "asc" },
        });
        return serializeBigInt({ items: companies });
    }

    async createCompany(
        user: JwtPayload,
        body: { name?: string; company_number?: string }
    ) {
        if (!body.name?.trim()) {
            throw new BadRequestException({
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
        return serializeBigInt(company);
    }

    async updateCompany(
        user: JwtPayload,
        body: { id?: number; name?: string }
    ) {
        if (body.id == null || !Number.isFinite(Number(body.id))) {
            throw new BadRequestException({
                error: "Company ID is required",
            });
        }
        if (!body.name?.trim()) {
            throw new BadRequestException({
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
        return serializeBigInt(updated);
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
