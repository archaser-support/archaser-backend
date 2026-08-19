import type { Invoice, PrismaClient } from "@prisma/client";
export interface CreditInvoiceAssignment {
    creditInvoiceId: number;
    targetInvoiceId: number;
    creditAmount: number;
}
export declare function assignCreditInvoice(prisma: PrismaClient, assignment: CreditInvoiceAssignment): Promise<{
    creditInvoice: Invoice;
    targetInvoice: Invoice;
}>;
