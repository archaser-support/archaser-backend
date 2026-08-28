import type { PrismaClient } from "@prisma/client";
import { INVOICE_PAID_TOLERANCE } from "@archaser/billing-connector";
import { bindCreditDomain, requireCreditDomainModule } from "./creditDomain";
import { recalculateCustomerAmountsViaApi } from "./customersDomain";

const INVOICE_STATUS = {
    DUE: "Due",
    OVERDUE: "Overdue",
    PAID: "Paid",
} as const;

/**
 * Close Due/Overdue invoices with near-zero customer outstanding debt
 * (within ±INVOICE_PAID_TOLERANCE), then recalculate customer rollups and
 * refresh credit-insurance fields. Large negative outstanding (credit notes)
 * is not treated as Paid.
 */
export async function closeZeroOutstandingDebtInvoices(
    prisma: PrismaClient
): Promise<{
    success: boolean;
    message: string;
    summary: {
        invoicesClosed: number;
        customersRecalculated: number;
    };
    durationMs: number;
}> {
    const start = Date.now();

    const openInvoices = await prisma.invoice.findMany({
        where: {
            status: { in: [INVOICE_STATUS.DUE, INVOICE_STATUS.OVERDUE] },
        },
        select: {
            id: true,
            net_amount: true,
            total_paid: true,
            customer_net_amount: true,
            customer_total_paid: true,
            amount: true,
            customer_amount: true,
            customer_id: true,
        },
    });

    for (const inv of openInvoices) {
        const customerNet =
            inv.customer_net_amount ?? inv.customer_amount ?? 0;
        const customerPaid = inv.customer_total_paid ?? 0;
        const net = inv.net_amount ?? inv.amount ?? 0;
        const paid = inv.total_paid ?? 0;

        await prisma.invoice.update({
            where: { id: inv.id },
            data: {
                customer_outstanding_debt: customerNet - customerPaid,
                outstanding_debt: net - paid,
            },
        });
    }

    const invoices = await prisma.invoice.findMany({
        where: {
            customer_outstanding_debt: {
                gte: -INVOICE_PAID_TOLERANCE,
                lte: INVOICE_PAID_TOLERANCE,
            },
            status: {
                in: [INVOICE_STATUS.DUE, INVOICE_STATUS.OVERDUE],
            },
        },
        select: {
            id: true,
            customer_id: true,
        },
    });

    if (invoices.length === 0) {
        return {
            success: true,
            message: "No zero-debt Due/Overdue invoices to close",
            summary: { invoicesClosed: 0, customersRecalculated: 0 },
            durationMs: Date.now() - start,
        };
    }

    await prisma.invoice.updateMany({
        where: { id: { in: invoices.map((invoice) => invoice.id) } },
        data: {
            status: INVOICE_STATUS.PAID,
            zero_limit_alert: false,
            reporting_breach: false,
        },
    });

    const customerIds = Array.from(
        new Set(
            invoices
                .map((invoice) => invoice.customer_id)
                .filter((id): id is number => id !== null && id !== undefined)
        )
    );

    await recalculateCustomerAmountsViaApi(customerIds, prisma);

    bindCreditDomain(prisma);
    const syncMod = requireCreditDomainModule<{
        syncCustomerInsuranceFields: (customerId: number) => Promise<unknown>;
    }>("domain/syncCustomerInsuranceFields.js");
    for (const customerId of customerIds) {
        await syncMod.syncCustomerInsuranceFields(customerId);
    }

    return {
        success: true,
        message: `Closed ${invoices.length} zero-debt invoices across ${customerIds.length} customers`,
        summary: {
            invoicesClosed: invoices.length,
            customersRecalculated: customerIds.length,
        },
        durationMs: Date.now() - start,
    };
}
