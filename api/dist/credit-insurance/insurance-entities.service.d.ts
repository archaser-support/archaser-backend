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
}
