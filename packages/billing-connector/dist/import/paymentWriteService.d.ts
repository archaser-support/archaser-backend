import type { Invoice, InvoicePayment, PrismaClient } from "@prisma/client";
export interface CreatePaymentData {
    invoice_id: number;
    invoice_number?: string;
    customer_currency: string;
    payment_date: Date;
    amount: number;
    payment_method: string;
    reference: string;
    customer_id: number;
    account_id: number;
    customer_amount: number;
    created_by?: string | null;
    modified_by?: string | null;
}
export interface CreateDeferredPaymentData {
    invoice_number: string;
    customer_currency: string;
    payment_date: Date;
    amount: number;
    payment_method: string;
    reference: string;
    customer_id: number;
    account_id: number;
    customer_amount: number;
    created_by?: string | null;
    modified_by?: string | null;
}
export interface UpdatePaymentData {
    id: number;
    invoice_id: number | null;
    invoice_number?: string;
    customer_currency: string;
    payment_date: Date;
    amount: number;
    payment_method: string;
    reference: string;
    customer_id: number;
    account_id: number;
    customer_amount: number;
    created_by?: string | null;
    modified_by?: string | null;
}
export interface PaymentWriteOptions {
    normalizeNegativePaymentsForCreditClose?: boolean;
}
export declare function createLinkedInvoicePayment(prisma: PrismaClient, data: CreatePaymentData, options?: PaymentWriteOptions): Promise<{
    invoicePayment: InvoicePayment;
    updatedInvoice: Invoice;
}>;
export declare function createDeferredInvoicePayment(prisma: PrismaClient, data: CreateDeferredPaymentData): Promise<InvoicePayment>;
export declare function updateInvoicePayment(prisma: PrismaClient, data: UpdatePaymentData, options?: PaymentWriteOptions): Promise<{
    invoicePayment: InvoicePayment;
}>;
