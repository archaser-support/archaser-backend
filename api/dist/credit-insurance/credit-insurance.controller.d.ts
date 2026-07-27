import { JwtPayload } from "../auth/auth.service";
import { CreditInsuranceService } from "./credit-insurance.service";
export declare class CreditInsuranceDomainController {
    private readonly creditInsurance;
    constructor(creditInsurance: CreditInsuranceService);
    handle(leaf: string, user: JwtPayload, query: Record<string, unknown>, body: Record<string, unknown>): Promise<import("./domain/creditInsuranceDashboardService").CreditDashboardSummary | import("./domain/creditDashboardSnapshotService").CreditDashboardSummaryHistory | import("./domain/creditPortfolioHealthService").CreditPortfolioHealthResponse | import("./domain/customerPolicyTrendService").CustomerPolicyUsageTrendResponse | import("./domain/customerPolicyTrendService").CustomerPolicyCustomerTrendResponse | import("./domain/insurancePolicyTrendService").InsurancePolicyTrendResponse | import("./domain/insurancePolicyTrendService").InsurancePolicyCountryTrendResponse | import("./domain/insurancePolicyTrendService").NamedPolicyTrendResponse | import("./domain/insurancePolicyTrendService").InsurancePolicyConfigChangesResponse | {
        data: {
            id: number;
        }[];
        totalRecords: number;
    } | {
        kpis: {};
    } | {
        ok: boolean;
        updated: number;
    } | {
        ok: boolean;
    }>;
}
