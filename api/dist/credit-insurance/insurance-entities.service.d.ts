import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare const INSURANCE_ENTITY_TYPES: readonly ["insurance-policies", "insurance-policy-countries", "insurance-policy-named-policies"];
export type InsuranceEntityType = (typeof INSURANCE_ENTITY_TYPES)[number];
export type InsuranceEntityListQuery = {
    page?: string;
    limit?: string;
};
export declare class InsuranceEntitiesService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    private delegate;
    private accountId;
    parseId(entityType: InsuranceEntityType, raw: string): number | string;
    list(entityType: InsuranceEntityType, user: JwtPayload, query: InsuranceEntityListQuery): Promise<{
        [x: string]: any;
        totalRecords: any;
        page: number;
        limit: number;
    }>;
    getById(entityType: InsuranceEntityType, user: JwtPayload, id: number | string): Promise<any>;
    update(entityType: InsuranceEntityType, user: JwtPayload, id: number | string, body: Record<string, unknown>): Promise<any>;
    create(entityType: InsuranceEntityType, user: JwtPayload, body: Record<string, unknown>): Promise<{
        id: string;
        created_at: Date;
        modified_at: Date;
        created_by: string | null;
        modified_by: string | null;
        country_id: number;
        insurance_policy_id: number;
        reporting_days: number | null;
        payment_term_cap: number | null;
        country_mep: number | null;
        country_max_limit: import("@prisma/client/runtime/library").Decimal | null;
    } | {
        id: number;
        created_at: Date;
        modified_at: Date;
        created_by: string | null;
        modified_by: string | null;
        customer_number: string;
        insurance_policy_id: number;
        max_payment_term: number | null;
        reporting_days: number | null;
        customer_mep: number | null;
        customer_max_limit: import("@prisma/client/runtime/library").Decimal | null;
        limit_expiration_date: Date | null;
    }>;
    remove(entityType: InsuranceEntityType, user: JwtPayload, id: number | string): Promise<{
        success: boolean;
    }>;
    customerPrefill(user: JwtPayload, policyId: number, query: Record<string, string | undefined>): Promise<{
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
    bulkReplacePolicy(user: JwtPayload, body: {
        oldPolicyId?: number;
        newPolicyId?: number;
    }): Promise<{
        updatedCount: number;
    }>;
}
