import { OnModuleInit } from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
import { CreditDashboardAccessService } from "./credit-dashboard-access.service";
import { CreditInsuranceLeavesService } from "./credit-insurance-leaves.service";
export declare class CreditInsuranceService implements OnModuleInit {
    private readonly db;
    private readonly accessScope;
    private readonly access;
    private readonly leaves;
    constructor(db: DatabaseService, accessScope: AccessScopeService, access: CreditDashboardAccessService, leaves: CreditInsuranceLeavesService);
    onModuleInit(): void;
    private accountId;
    handle(leaf: string, user: JwtPayload, query: Record<string, unknown>, body: Record<string, unknown>): Promise<import("./domain/creditInsuranceDashboardService").CreditDashboardSummary | import("./domain/creditDashboardSnapshotService").CreditDashboardSummaryHistory | import("./domain/creditPortfolioHealthService").CreditPortfolioHealthResponse | import("./domain/customerDashboardKpisService").CustomerDashboardKpisResponse | import("./domain/customerPolicyTrendService").CustomerPolicyUsageTrendResponse | import("./domain/customerPolicyTrendService").CustomerPolicyCustomerTrendResponse | import("./domain/insurancePolicyTrendService").InsurancePolicyTrendResponse | import("./domain/insurancePolicyTrendService").InsurancePolicyCountryTrendResponse | import("./domain/insurancePolicyTrendService").NamedPolicyTrendResponse | import("./domain/insurancePolicyTrendService").InsurancePolicyConfigChangesResponse | {
        data: {
            id: number;
        }[];
        totalRecords: number;
    } | {
        ok: boolean;
        updated: number;
    } | {
        ok: boolean;
    }>;
    private parsePolicyId;
    private parseIncludeNoPolicyExposure;
    private summary;
    private parseCustomerId;
    private parseDays;
    private customerDashboardKpis;
    private markReported;
    private markReportedBulk;
}
