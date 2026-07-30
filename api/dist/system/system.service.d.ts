import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export type SystemListQuery = Record<string, string | undefined>;
export declare class SystemService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    private scope;
    private emptyChart;
    private startOfUtcDay;
    private endOfUtcDay;
    private addDays;
    private accountCurrency;
    private sumOutstanding;
    private dashboardCacheKey;
    private tryDashboardCache;
    private buildCollectedVsPromiseSeries;
    private buildCategoryWidgets;
    private buildAgingPortfolio;
    getDashboard(user: JwtPayload, query?: SystemListQuery): Promise<Record<string, unknown> | {
        activeCustomers: number;
        overdueAmount: number;
        overdueInvoices: number;
        totalCollected: number;
        totalDue: number;
        dueToday: number;
        dueThisWeek: number;
        dueThisMonth: number;
        dueNextMonth: number;
        currency: string;
        collectionStats: import("./financial-dashboard.builder").CollectionStat[];
        categoryStats: never[];
        disputeStats: {
            totalDisputeAmount: number;
            uniqueCustomerCount: number;
            disputeInvoiceCount: number;
            totalClosed: number;
        };
        audienceReport: {
            options: {
                chart: {
                    type: string;
                    toolbar: {
                        show: boolean;
                    };
                };
                xaxis: {
                    categories: string[];
                };
                stroke: {
                    width: number[];
                    curve: string;
                };
                plotOptions: {
                    bar: {
                        columnWidth: string;
                    };
                };
            };
            series: {
                name: string;
                type: string;
                data: number[];
            }[];
        };
        agingPortfolio: {
            chartData: import("./financial-dashboard.builder").AgingRangeRow[];
            details: never[];
        };
        collectionEffortsPhase: {
            options: {
                labels: string[];
            };
            series: number[];
            stats: import("./financial-dashboard.builder").PhaseStat[];
        };
        automatedPhaseSplit: {
            options: {};
            series: never[];
        };
        activeCustomersChart: {
            options: {};
            series: never[];
        };
        receivablesMaturitySchedule: never[];
        invoicesByCustomer: never[];
        invoicesByBusinessUnit: never[];
        overdueInvoicesByCustomer: never[];
        overdueInvoicesByBusinessUnit: never[];
        lastSynced: string;
        viewMode: string;
        hasChildBusinessUnits: boolean;
        fromCache: boolean;
    }>;
    private openCollectionPeriodFilter;
    private selectedBusinessUnitFilter;
    private resolveAgingBucket;
    getChartDetails(user: JwtPayload, query?: SystemListQuery): Promise<{
        details: never[];
        data: never[];
        totalRecords: number;
        summary: {
            totalRecords: number;
            totalAmount: number;
        };
        currency: string;
    } | {
        details: never[];
        totalRecords: number;
    }>;
    getControlCenter(user: JwtPayload, operation?: string | null): Promise<{
        agents: {
            email: string;
            role: import(".prisma/client").$Enums.user_role | null;
            name: string | null;
            id: string;
            image: string | null;
            first_name: string | null;
            last_name: string | null;
            business_unit_id: number | null;
        }[];
        agentCount: number;
        stats: {
            activeCustomers: number;
            overdueInvoices: number;
            openDisputes: number;
        };
        noContacts: {
            active: number;
            inactive: number;
        };
        invalidContacts: {
            active: number;
            inactive: number;
        };
        invoicesWithoutCustomer: {
            total: number;
        };
        orphanCreditInvoices: {
            total: number;
        };
    }>;
    postControlCenter(user: JwtPayload, operation: string | null | undefined, body: Record<string, unknown>): Promise<{
        success: boolean;
        message: string;
        affectedCustomerIds: never[];
    }>;
    getOperationDashboard(user: JwtPayload, query?: SystemListQuery): Promise<{
        aggregate: {
            activities: {
                manual: number;
                automated: number;
                byType: {
                    SMS: number;
                    Email: number;
                    Call: number;
                    WhatsApp: number;
                    Internal: number;
                };
                delivered: number;
                failed: number;
                successRate: number;
            };
            disputes: {
                created: number;
                closed: number;
                open: number;
                averageResolutionDays: number;
            };
            calls: {
                total: number;
                successful: number;
                successRate: number;
                byOutcome: {};
            };
            promises: {
                total: number;
                fulfilled: number;
                fulfillmentRate: number;
                totalAmount: number;
            };
            productivity: {
                averageActivitiesPerAgent: number;
                averageActivitiesPerDay: number;
                topPerformingAgent: {
                    userId: string;
                    name: string;
                    activities: number;
                } | null;
            };
            issues: {
                undeliveredActivities: number;
                missingContacts: number;
                automationStuck: number;
                overdueFollowUps: number;
                invalidTemplates: number;
            };
            userCounts: {
                system: number;
                portal: number;
            };
        };
        agents: {
            userId: string;
            name: string;
            email: string;
            image: string | null;
            activities: {
                manual: number;
                automated: number;
                byType: Record<string, number>;
                delivered: number;
                failed: number;
            };
            disputes: {
                created: number;
                closed: number;
                open: number;
            };
            calls: {
                total: number;
                successful: number;
                byOutcome: {};
            };
            promises: {
                total: number;
                fulfilled: number;
                totalAmount: number;
            };
            productivity: {
                activitiesPerDay: number;
                averageDisputeResolutionDays: number;
            };
            issues: {
                undeliveredActivities: number;
                missingContacts: number;
                automationStuck: number;
                overdueFollowUps: number;
            };
        }[];
        currency: string;
        dateRange: {
            startDate: string;
            endDate: string;
        };
        disputeTrend: {
            dates: string[];
            created: number[];
            closed: number[];
        };
        fromCache: boolean;
    }>;
    getOperationDashboardDetails(_user: JwtPayload, _query?: SystemListQuery): Promise<{
        data: never[];
        totalRecords: number;
        hasMore: boolean;
    }>;
    private agentsCustomerSelect;
    getAgents(user: JwtPayload, query?: SystemListQuery): Promise<{
        agents: ({
            Customer: {
                id: number;
                business_unit_id: number | null;
                BusinessUnit: {
                    name: string;
                    id: number;
                } | null;
                country_id: number | null;
                state_id: number | null;
                Country: {
                    name: string;
                    id: number;
                    iso2: string | null;
                } | null;
                State: {
                    name: string;
                    id: number;
                    iso2: string | null;
                } | null;
                Company: {
                    name: string;
                } | null;
                Person: {
                    first_name: string | null;
                    last_name: string | null;
                } | null;
                customer_number: string | null;
                number_of_overdue_invoices: number | null;
                total_overdue_amount: number | null;
                oldest_invoice_overdue_date: Date | null;
                owner_id: string | null;
            };
        } & {
            id: number;
            created_at: Date;
            modified_at: Date;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            next_activity_date: Date | null;
            priority: import(".prisma/client").$Enums.priority | null;
            customer_id: number;
            period_start_date: Date;
            period_end_date: Date | null;
            last_automated_step: number | null;
            previous_category: import(".prisma/client").$Enums.category | null;
            current_category: import(".prisma/client").$Enums.category | null;
            total_outstanding_amount: number | null;
            no_of_overdue_invoices: number | null;
            promise_to_pay_date: Date | null;
            last_dispute_date: Date | null;
            customer_outstanding_amount1: number | null;
            customer_outstanding_amount2: number | null;
            customer_currency1: string | null;
            customer_currency2: string | null;
            last_call: Date | null;
            last_call_result: string | null;
            follow_up_time: Date | null;
            promise_to_pay_amount: number | null;
            next_category: import(".prisma/client").$Enums.category | null;
            next_category_date: Date | null;
            create_next_activity: boolean;
            promise_to_pay_count: number;
            is_last_automated_step_delivered: boolean;
            risk_score: import("@prisma/client/runtime/library").Decimal | null;
            risk_factors: import("@prisma/client/runtime/library").JsonValue | null;
            last_risk_calculation: Date | null;
            risk_category: string | null;
            lawyer_assigned: boolean;
        })[];
        totalRecords: number;
        currentPage: number;
        totalPages: number;
        currency: string;
    }>;
    getAgentsFollowUp(user: JwtPayload): Promise<{
        agents: ({
            Customer: {
                id: number;
                business_unit_id: number | null;
                BusinessUnit: {
                    name: string;
                    id: number;
                } | null;
                country_id: number | null;
                state_id: number | null;
                Country: {
                    name: string;
                    id: number;
                    iso2: string | null;
                } | null;
                State: {
                    name: string;
                    id: number;
                    iso2: string | null;
                } | null;
                Company: {
                    name: string;
                } | null;
                Person: {
                    first_name: string | null;
                    last_name: string | null;
                } | null;
                customer_number: string | null;
                number_of_overdue_invoices: number | null;
                total_overdue_amount: number | null;
                oldest_invoice_overdue_date: Date | null;
                owner_id: string | null;
            };
        } & {
            id: number;
            created_at: Date;
            modified_at: Date;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            next_activity_date: Date | null;
            priority: import(".prisma/client").$Enums.priority | null;
            customer_id: number;
            period_start_date: Date;
            period_end_date: Date | null;
            last_automated_step: number | null;
            previous_category: import(".prisma/client").$Enums.category | null;
            current_category: import(".prisma/client").$Enums.category | null;
            total_outstanding_amount: number | null;
            no_of_overdue_invoices: number | null;
            promise_to_pay_date: Date | null;
            last_dispute_date: Date | null;
            customer_outstanding_amount1: number | null;
            customer_outstanding_amount2: number | null;
            customer_currency1: string | null;
            customer_currency2: string | null;
            last_call: Date | null;
            last_call_result: string | null;
            follow_up_time: Date | null;
            promise_to_pay_amount: number | null;
            next_category: import(".prisma/client").$Enums.category | null;
            next_category_date: Date | null;
            create_next_activity: boolean;
            promise_to_pay_count: number;
            is_last_automated_step_delivered: boolean;
            risk_score: import("@prisma/client/runtime/library").Decimal | null;
            risk_factors: import("@prisma/client/runtime/library").JsonValue | null;
            last_risk_calculation: Date | null;
            risk_category: string | null;
            lawyer_assigned: boolean;
        })[];
        followUps: ({
            Customer: {
                id: number;
                business_unit_id: number | null;
                BusinessUnit: {
                    name: string;
                    id: number;
                } | null;
                country_id: number | null;
                state_id: number | null;
                Country: {
                    name: string;
                    id: number;
                    iso2: string | null;
                } | null;
                State: {
                    name: string;
                    id: number;
                    iso2: string | null;
                } | null;
                Company: {
                    name: string;
                } | null;
                Person: {
                    first_name: string | null;
                    last_name: string | null;
                } | null;
                customer_number: string | null;
                number_of_overdue_invoices: number | null;
                total_overdue_amount: number | null;
                oldest_invoice_overdue_date: Date | null;
                owner_id: string | null;
            };
        } & {
            id: number;
            created_at: Date;
            modified_at: Date;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            next_activity_date: Date | null;
            priority: import(".prisma/client").$Enums.priority | null;
            customer_id: number;
            period_start_date: Date;
            period_end_date: Date | null;
            last_automated_step: number | null;
            previous_category: import(".prisma/client").$Enums.category | null;
            current_category: import(".prisma/client").$Enums.category | null;
            total_outstanding_amount: number | null;
            no_of_overdue_invoices: number | null;
            promise_to_pay_date: Date | null;
            last_dispute_date: Date | null;
            customer_outstanding_amount1: number | null;
            customer_outstanding_amount2: number | null;
            customer_currency1: string | null;
            customer_currency2: string | null;
            last_call: Date | null;
            last_call_result: string | null;
            follow_up_time: Date | null;
            promise_to_pay_amount: number | null;
            next_category: import(".prisma/client").$Enums.category | null;
            next_category_date: Date | null;
            create_next_activity: boolean;
            promise_to_pay_count: number;
            is_last_automated_step_delivered: boolean;
            risk_score: import("@prisma/client/runtime/library").Decimal | null;
            risk_factors: import("@prisma/client/runtime/library").JsonValue | null;
            last_risk_calculation: Date | null;
            risk_category: string | null;
            lawyer_assigned: boolean;
        })[];
        totalRecords: number;
        currency: string;
    }>;
    getAgentsStats(user: JwtPayload, query?: SystemListQuery): Promise<{
        stats: {
            counts: {
                total_customers: number;
                total_invoices: number;
                total_outstanding_amount: number;
                currency: string;
            };
        };
        totalAgents: number;
        totalOutstandingAmount: number;
    }>;
    getPromiseToPay(user: JwtPayload, query?: SystemListQuery): Promise<{
        promiseToPayList: ({
            Customer: {
                id: number;
                Company: {
                    name: string;
                } | null;
                Person: {
                    first_name: string | null;
                    last_name: string | null;
                } | null;
                customer_number: string | null;
                number_of_overdue_invoices: number | null;
                total_overdue_amount: number | null;
                oldest_invoice_overdue_date: Date | null;
            };
        } & {
            id: number;
            created_at: Date;
            modified_at: Date;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            next_activity_date: Date | null;
            priority: import(".prisma/client").$Enums.priority | null;
            customer_id: number;
            period_start_date: Date;
            period_end_date: Date | null;
            last_automated_step: number | null;
            previous_category: import(".prisma/client").$Enums.category | null;
            current_category: import(".prisma/client").$Enums.category | null;
            total_outstanding_amount: number | null;
            no_of_overdue_invoices: number | null;
            promise_to_pay_date: Date | null;
            last_dispute_date: Date | null;
            customer_outstanding_amount1: number | null;
            customer_outstanding_amount2: number | null;
            customer_currency1: string | null;
            customer_currency2: string | null;
            last_call: Date | null;
            last_call_result: string | null;
            follow_up_time: Date | null;
            promise_to_pay_amount: number | null;
            next_category: import(".prisma/client").$Enums.category | null;
            next_category_date: Date | null;
            create_next_activity: boolean;
            promise_to_pay_count: number;
            is_last_automated_step_delivered: boolean;
            risk_score: import("@prisma/client/runtime/library").Decimal | null;
            risk_factors: import("@prisma/client/runtime/library").JsonValue | null;
            last_risk_calculation: Date | null;
            risk_category: string | null;
            lawyer_assigned: boolean;
        })[];
        totalRecords: number;
    }>;
    getPromiseToPayStats(user: JwtPayload): Promise<{
        total: number;
        totalPromiseAmount: number;
        totalOutstandingAmount: number;
    }>;
    postPromiseToPay(_user: JwtPayload, body: Record<string, unknown>): Promise<{
        success: boolean;
        message: string;
        body: Record<string, unknown>;
    }>;
    getCronJobs(_user: JwtPayload): Promise<{
        cronJobs: {
            id: number;
            name: string;
            active: boolean | null;
            cronExpression: string;
            lastRunAt: Date | null;
            nextRunAt: Date | null;
            timeoutPeriodSeconds: number;
            sortOrder: number;
            createdAt: Date;
            modifiedAt: Date;
        }[];
    } | {
        cronJobs: never[];
        message: string;
    }>;
    postCronJobs(_user: JwtPayload, body?: Record<string, unknown>): Promise<{
        success: boolean;
        message: string;
        timestamp: string;
        body: Record<string, unknown>;
    }>;
    cacheInvalidation(body: Record<string, unknown>): Promise<{
        success: boolean;
        message: string;
        timestamp: string;
        source: string;
        reason: {};
        affectedCustomerIds: {};
        affectedInvoiceIds: {};
    }>;
    getSharedStats(user: JwtPayload, operation: string): Promise<{
        total_accounts: number;
        currency: string;
        total_overdue_amount?: undefined;
        total?: undefined;
    } | {
        total_overdue_amount: number;
        currency: string;
        total_accounts?: undefined;
        total?: undefined;
    } | {
        total: number;
        currency: string;
        total_accounts?: undefined;
        total_overdue_amount?: undefined;
    }>;
}
