import { JwtPayload } from "../auth/auth.service";
import { InsuranceEntitiesService } from "./insurance-entities.service";
export declare class InsurancePoliciesActionsController {
    private readonly insurance;
    constructor(insurance: InsuranceEntitiesService);
    bulkReplace(user: JwtPayload, body: {
        oldPolicyId?: number;
        newPolicyId?: number;
    }): Promise<{
        updatedCount: number;
    }>;
    customerPrefill(user: JwtPayload, id: number, query: Record<string, string | undefined>): Promise<{
        source: string;
        limit_type: string;
        max_payment_term: number | null;
        max_allowed_mep: number | null;
        reporting_days: number | null;
        mep_cutoff_day_of_month: number | null;
        mep_substitute_day_of_month: number | null;
        reporting_cutoff_day_of_month: number | null;
        reporting_substitute_day_of_month: number | null;
        payment_term_cutoff_day_of_month: number | null;
        payment_term_substitute_day_of_month: number | null;
        approved_limit: {} | null;
        approved_limit_expiration_date: Date | null;
        credit_score: null;
        customer_number_policy: string | null;
    } | {
        source: string;
    }>;
}
