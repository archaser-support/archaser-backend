import type { Invoice, InvoicePayment, Prisma, PrismaClient } from "@prisma/client";
import { isWithinPaidTolerance } from "./invoicePaidTolerance";
import { resolveAccountBillingExtension } from "../extensions";
import type { ExtensionLinkedPayment } from "../extensions/types";
import { commitOps } from "../import/bulkWrite";

export type LinkDeferredPaymentAndRecalcResult = {
    invoicePayment: InvoicePayment;
    updatedInvoice: Invoice;
    alreadyLinked: boolean;
};

export {
    INVOICE_PAID_TOLERANCE,
    isWithinPaidTolerance,
} from "./invoicePaidTolerance";

export type InvoicePaidRecalcOptions = {
    normalizeNegativePaymentsForCreditClose?: boolean;
    isForcePaidClose?: (payment: ExtensionLinkedPayment) => boolean;
};

type LinkedPaymentForRecalc = {
    id: number;
    payment_date: Date;
    amount: number | null;
    customer_amount: number | null;
    payment_method: string | null;
    reference: string | null;
};

type InvoiceForPaidRecalc = Pick<
    Invoice,
    "id" | "net_amount" | "customer_net_amount" | "custom_code1" | "status"
>;

const LINKED_PAYMENT_RECALC_SELECT = {
    id: true,
    payment_date: true,
    amount: true,
    customer_amount: true,
    payment_method: true,
    reference: true,
} as const;

function hasForcePaidClose(
    payments: LinkedPaymentForRecalc[],
    isForcePaidClose?: (payment: ExtensionLinkedPayment) => boolean
): boolean {
    if (!isForcePaidClose) return false;
    return payments.some((payment) => isForcePaidClose(payment));
}

async function resolveForcePaidClose(
    prisma: unknown,
    accountId: number,
    existing?: InvoicePaidRecalcOptions["isForcePaidClose"]
): Promise<InvoicePaidRecalcOptions["isForcePaidClose"]> {
    if (existing) return existing;
    const extension = await resolveAccountBillingExtension(
        prisma as Parameters<typeof resolveAccountBillingExtension>[0],
        accountId
    );
    return extension?.isForcePaidClose;
}

function buildInvoicePaidUpdate(
    invoice: InvoiceForPaidRecalc,
    linkedPayments: LinkedPaymentForRecalc[],
    options: InvoicePaidRecalcOptions | undefined,
    modifiedAt: Date
): Prisma.InvoiceUpdateInput {
    if (hasForcePaidClose(linkedPayments, options?.isForcePaidClose)) {
        const totalPaid = invoice.net_amount ?? 0;
        const totalCustomerPaid = invoice.customer_net_amount ?? 0;
        return {
            total_paid: totalPaid,
            customer_total_paid: totalCustomerPaid,
            outstanding_debt: 0,
            customer_outstanding_debt: 0,
            status: "Paid",
            zero_limit_alert: false,
            reporting_breach: false,
            modified_at: modifiedAt,
        };
    }

    const useAbsPaidTotals =
        options?.normalizeNegativePaymentsForCreditClose === true &&
        invoice.custom_code1 === "C";

    let totalPaid = 0;
    let totalCustomerPaid = 0;

    if (useAbsPaidTotals) {
        for (const payment of linkedPayments) {
            totalPaid += Math.abs(payment.amount ?? 0);
            totalCustomerPaid += Math.abs(payment.customer_amount ?? 0);
        }
    } else {
        for (const payment of linkedPayments) {
            totalPaid += payment.amount ?? 0;
            totalCustomerPaid += payment.customer_amount ?? 0;
        }
    }

    const newOutstanding = (invoice.net_amount ?? 0) - totalPaid;
    const newCustomerOutstanding =
        (invoice.customer_net_amount ?? 0) - totalCustomerPaid;
    const becomesPaid = isWithinPaidTolerance(newCustomerOutstanding);

    return {
        total_paid: totalPaid,
        customer_total_paid: totalCustomerPaid,
        outstanding_debt: newOutstanding,
        customer_outstanding_debt: newCustomerOutstanding,
        status: becomesPaid ? "Paid" : invoice.status,
        modified_at: modifiedAt,
        ...(becomesPaid && {
            zero_limit_alert: false,
            reporting_breach: false,
        }),
    };
}

export async function recalculateInvoiceFromLinkedPayments(
    tx: Pick<PrismaClient, "invoice" | "invoicePayment">,
    invoiceId: number,
    options?: InvoicePaidRecalcOptions
): Promise<Invoice> {
    const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
    });

    if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
    }

    const linkedPayments = await tx.invoicePayment.findMany({
        where: { invoice_id: invoiceId },
        select: LINKED_PAYMENT_RECALC_SELECT,
    });

    const isForcePaidClose = await resolveForcePaidClose(
        tx,
        invoice.account_id,
        options?.isForcePaidClose
    );

    return tx.invoice.update({
        where: { id: invoiceId },
        data: buildInvoicePaidUpdate(
            invoice,
            linkedPayments,
            { ...options, isForcePaidClose },
            new Date()
        ),
    });
}

/**
 * Recalculate many invoices with two reads and chunked writes instead of
 * three round-trips per invoice.
 */
export async function recalculateInvoicesFromLinkedPayments(
    prisma: Pick<PrismaClient, "invoice" | "invoicePayment" | "$transaction">,
    targets: Map<number, InvoicePaidRecalcOptions>
): Promise<void> {
    if (targets.size === 0) return;

    const invoiceIds = [...targets.keys()];
    const [invoices, linkedPayments] = await Promise.all([
        prisma.invoice.findMany({
            where: { id: { in: invoiceIds } },
            select: {
                id: true,
                account_id: true,
                net_amount: true,
                customer_net_amount: true,
                custom_code1: true,
                status: true,
            },
        }),
        prisma.invoicePayment.findMany({
            where: { invoice_id: { in: invoiceIds } },
            select: {
                ...LINKED_PAYMENT_RECALC_SELECT,
                invoice_id: true,
            },
        }),
    ]);

    const paymentsByInvoiceId = new Map<number, LinkedPaymentForRecalc[]>();
    for (const payment of linkedPayments) {
        if (payment.invoice_id == null) continue;
        const list = paymentsByInvoiceId.get(payment.invoice_id) ?? [];
        list.push(payment);
        paymentsByInvoiceId.set(payment.invoice_id, list);
    }

    const forcePaidByAccount = new Map<
        number,
        InvoicePaidRecalcOptions["isForcePaidClose"]
    >();
    for (const invoice of invoices) {
        if (forcePaidByAccount.has(invoice.account_id)) continue;
        const target = targets.get(invoice.id);
        forcePaidByAccount.set(
            invoice.account_id,
            await resolveForcePaidClose(
                prisma,
                invoice.account_id,
                target?.isForcePaidClose
            )
        );
    }

    const modifiedAt = new Date();
    await commitOps(
        prisma,
        invoices.map((invoice) =>
            prisma.invoice.update({
                where: { id: invoice.id },
                data: buildInvoicePaidUpdate(
                    invoice,
                    paymentsByInvoiceId.get(invoice.id) ?? [],
                    {
                        ...targets.get(invoice.id),
                        isForcePaidClose: forcePaidByAccount.get(
                            invoice.account_id
                        ),
                    },
                    modifiedAt
                ),
            })
        )
    );
}

export async function linkDeferredPaymentAndRecalc(
    prisma: PrismaClient,
    params: {
        invoicePaymentId: number;
        invoiceId: number;
        forceRecalc?: boolean;
    }
): Promise<LinkDeferredPaymentAndRecalcResult> {
    const { invoicePaymentId, invoiceId, forceRecalc = false } = params;

    return prisma.$transaction(async (tx) => {
        const payment = await tx.invoicePayment.findUnique({
            where: { id: invoicePaymentId },
        });

        if (!payment) {
            throw new Error(`InvoicePayment ${invoicePaymentId} not found`);
        }

        if (payment.invoice_id === invoiceId) {
            if (!forceRecalc) {
                const invoice = await tx.invoice.findUnique({
                    where: { id: invoiceId },
                });
                if (!invoice) {
                    throw new Error(`Invoice ${invoiceId} not found`);
                }
                return {
                    invoicePayment: payment,
                    updatedInvoice: invoice,
                    alreadyLinked: true,
                };
            }

            const updatedInvoice = await recalculateInvoiceFromLinkedPayments(
                tx,
                invoiceId
            );
            return {
                invoicePayment: payment,
                updatedInvoice,
                alreadyLinked: true,
            };
        }

        if (payment.invoice_id !== null) {
            throw new Error(
                `InvoicePayment ${invoicePaymentId} is already linked to invoice ${payment.invoice_id}`
            );
        }

        const linkedPayment = await tx.invoicePayment.update({
            where: { id: invoicePaymentId },
            data: { invoice_id: invoiceId, modified_at: new Date() },
        });

        const updatedInvoice = await recalculateInvoiceFromLinkedPayments(
            tx,
            invoiceId
        );

        return {
            invoicePayment: linkedPayment,
            updatedInvoice,
            alreadyLinked: false,
        };
    });
}
