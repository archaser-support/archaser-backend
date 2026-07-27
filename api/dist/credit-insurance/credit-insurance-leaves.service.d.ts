import { OnModuleInit } from "@nestjs/common";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
import { CreditDashboardAccessService } from "./credit-dashboard-access.service";
export declare class CreditInsuranceLeavesService implements OnModuleInit {
    private readonly db;
    private readonly access;
    constructor(db: DatabaseService, access: CreditDashboardAccessService);
    onModuleInit(): void;
    summaryHistory(user: JwtPayload, query: Record<string, unknown>): Promise<import("./domain/creditDashboardSnapshotService").CreditDashboardSummaryHistory>;
    portfolioHealth(user: JwtPayload, query: Record<string, unknown>): Promise<import("./domain/creditPortfolioHealthService").CreditPortfolioHealthResponse>;
    customerPolicyTrend(user: JwtPayload, query: Record<string, unknown>): Promise<import("./domain/customerPolicyTrendService").CustomerPolicyUsageTrendResponse | import("./domain/customerPolicyTrendService").CustomerPolicyCustomerTrendResponse>;
    insurancePolicyTrend(user: JwtPayload, query: Record<string, unknown>): Promise<import("./domain/insurancePolicyTrendService").InsurancePolicyTrendResponse | import("./domain/insurancePolicyTrendService").InsurancePolicyCountryTrendResponse | import("./domain/insurancePolicyTrendService").NamedPolicyTrendResponse | import("./domain/insurancePolicyTrendService").InsurancePolicyConfigChangesResponse>;
    report(user: JwtPayload, query: Record<string, unknown>): Promise<{
        data: {
            id: number;
        }[];
        totalRecords: number;
    }>;
    private runReport;
    private assertPolicyInAccount;
    private parseOptionalPolicyId;
    private parseOptionalPositiveInt;
    private parseOptionalString;
    private parseOptionalDate;
    private parseDays;
    private parseIntParam;
    private parsePage;
    private parseIncludeNoPolicyExposure;
    private parseTruthy;
    private parseTrendScope;
    private parseReportType;
    private parseTermsBreachReason;
}
