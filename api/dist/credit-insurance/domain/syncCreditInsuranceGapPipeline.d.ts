import { type DbClient } from "../domain-db";
export declare function syncCreditInsuranceGapPipelineForCustomer(customerId: number, options?: {
    invoiceIds?: number[];
    dbClient?: DbClient;
    skipPolicyAggregate?: boolean;
    skipFlags?: boolean;
    rateDate?: Date;
}): Promise<{
    missingRate: boolean;
}>;
export declare function ensureCustomerCapacityGapStored(customerId: number, options?: {
    invoiceIds?: number[];
    dbClient?: DbClient;
    rateDate?: Date;
}): Promise<void>;
