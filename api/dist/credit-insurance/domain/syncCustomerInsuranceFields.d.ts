import { type DbClient } from "../domain-db";
export type SyncCustomerInsuranceFieldsOptions = {
    dbClient?: DbClient;
    runFollowUpEffects?: boolean;
    validateZeroLimitDate?: boolean;
    invoiceIds?: number[];
    asOfDate?: Date;
    refreshTermsBreachFlags?: boolean;
};
export declare function syncCustomerInsuranceFields(customerId: number, options?: SyncCustomerInsuranceFieldsOptions): Promise<void>;
