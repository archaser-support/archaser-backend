import type { PrismaClient } from "@prisma/client";
import type { InvoicePaymentInput } from "./normalizePaymentInput";
export interface ImportPaymentResult {
    index: number;
    success: boolean;
    skipped?: boolean;
    deferred?: boolean;
    invoicePaymentId?: number;
    customerId?: number;
    message?: string;
}
export declare function importPayments(prisma: PrismaClient, paymentRecords: InvoicePaymentInput[], accountId: number, userId?: string): Promise<ImportPaymentResult[]>;
