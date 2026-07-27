import type { DbClient } from "../domain-db";
export declare function stampInvoiceInsuranceFieldsAsOf(invoiceId: number, asOf: Date, db?: DbClient): Promise<void>;
