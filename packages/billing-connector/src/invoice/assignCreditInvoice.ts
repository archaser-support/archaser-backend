import type { Invoice, PrismaClient } from "@prisma/client";

export interface CreditInvoiceAssignment {
    creditInvoiceId: number;
    targetInvoiceId: number;
    creditAmount: number;
}

export async function assignCreditInvoice(
    prisma: PrismaClient,
    assignment: CreditInvoiceAssignment
): Promise<{ creditInvoice: Invoice; targetInvoice: Invoice }> {
    const { creditInvoiceId, targetInvoiceId, creditAmount } = assignment;

    const currentTargetInvoice = await prisma.invoice.findUnique({
        where: { id: targetInvoiceId },
        select: {
            amount: true,
            total_paid: true,
            customer_total_paid: true,
            net_amount: true,
            customer_net_amount: true,
            outstanding_debt: true,
            customer_amount: true,
            customer_outstanding_debt: true,
            invoice_number: true,
        },
    });

    if (!currentTargetInvoice) {
        throw new Error(`Target invoice ${targetInvoiceId} not found`);
    }

    const currentCustomerNetAmount =
        currentTargetInvoice.customer_net_amount || 0;
    const currentTotalPaid = currentTargetInvoice.total_paid || 0;
    const newCustomerNetAmount = Math.max(
        0,
        currentCustomerNetAmount - creditAmount
    );

    const originalAmount = currentTargetInvoice.amount || 0;
    const originalCustomerAmount = currentTargetInvoice.customer_amount || 0;
    let newNetAmount = 0;

    if (originalCustomerAmount > 0) {
        newNetAmount = newCustomerNetAmount;
    } else if (originalAmount > 0 && currentCustomerNetAmount > 0) {
        const ratio =
            originalAmount /
            (currentTargetInvoice.net_amount || originalAmount);
        newNetAmount = newCustomerNetAmount * ratio;
    } else if (currentCustomerNetAmount > 0) {
        const reductionRatio =
            newCustomerNetAmount / currentCustomerNetAmount;
        newNetAmount = (currentTargetInvoice.net_amount || 0) * reductionRatio;
    }

    const newOutstandingDebt = newNetAmount - currentTotalPaid;
    const currentCustomerTotalPaid =
        currentTargetInvoice.customer_total_paid || 0;
    const newCustomerOutstandingDebt = Math.max(
        0,
        newCustomerNetAmount - currentCustomerTotalPaid
    );

    return prisma.$transaction(async (tx) => {
        const creditInvoice = await tx.invoice.update({
            where: { id: creditInvoiceId },
            data: {
                credit_for_invoice_id: targetInvoiceId,
                credit_for_invoice_number:
                    currentTargetInvoice.invoice_number || null,
            },
        });
        const targetInvoice = await tx.invoice.update({
            where: { id: targetInvoiceId },
            data: {
                net_amount: newNetAmount,
                customer_net_amount: newCustomerNetAmount,
                outstanding_debt: newOutstandingDebt,
                customer_outstanding_debt: newCustomerOutstandingDebt,
            },
        });
        return { creditInvoice, targetInvoice };
    });
}
