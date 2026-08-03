import { Prisma, invoice_status } from "@prisma/client";
import { type DbClient } from "../domain-db";
export declare function isInvoiceEligibleForZeroLimitAlert(args: {
    status: invoice_status;
    invoiceDate: Date;
    zeroLimitDate: Date | null;
    approvedLimit: Prisma.Decimal | null | undefined;
}): boolean;
export declare function syncZeroLimitAlertFlagsForCustomer(args: {
    customerId: number;
    dbClient?: DbClient;
    validateZeroLimitDate?: boolean;
}): Promise<{
    zeroLimitAlertExist: boolean;
}>;
