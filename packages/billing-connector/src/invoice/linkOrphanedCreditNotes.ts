import type { PrismaClient } from "@prisma/client";
import { assignCreditInvoice } from "./assignCreditInvoice";

export interface LinkOrphanedCreditNotesResult {
    linkedCount: number;
    affectedInvoiceIds: number[];
}

export async function linkOrphanedCreditNotes(
    prisma: PrismaClient,
    params: {
        accountId: number;
        targetInvoiceNumbers: string[];
    }
): Promise<LinkOrphanedCreditNotesResult> {
    const { accountId, targetInvoiceNumbers } = params;

    const uniqueNumbers = Array.from(
        new Set(targetInvoiceNumbers.filter((n): n is string => Boolean(n?.trim())))
    );

    if (uniqueNumbers.length === 0) {
        return { linkedCount: 0, affectedInvoiceIds: [] };
    }

    const targetInvoices = await prisma.invoice.findMany({
        where: {
            account_id: accountId,
            invoice_number: { in: uniqueNumbers },
            amount: { gt: 0 },
        },
        select: {
            id: true,
            invoice_number: true,
            customer_id: true,
            account_id: true,
        },
    });

    if (targetInvoices.length === 0) {
        return { linkedCount: 0, affectedInvoiceIds: [] };
    }

    const targetByNumber = new Map<
        string,
        { id: number; invoice_number: string }
    >();
    for (const inv of targetInvoices) {
        if (inv.invoice_number?.trim()) {
            targetByNumber.set(inv.invoice_number, {
                id: inv.id,
                invoice_number: inv.invoice_number,
            });
        }
    }

    const targetNumbers = Array.from(targetByNumber.keys());

    const orphanedCreditNotes = await prisma.invoice.findMany({
        where: {
            account_id: accountId,
            credit_for_invoice_number: { in: targetNumbers },
            credit_for_invoice_id: null,
            amount: { lte: 0 },
        },
        select: {
            id: true,
            invoice_number: true,
            credit_for_invoice_number: true,
            amount: true,
            customer_amount: true,
            net_amount: true,
            customer_net_amount: true,
        },
    });

    if (orphanedCreditNotes.length === 0) {
        return { linkedCount: 0, affectedInvoiceIds: [] };
    }

    let linkedCount = 0;
    const affectedInvoiceIds: number[] = [];

    for (const creditNote of orphanedCreditNotes) {
        if (!creditNote.credit_for_invoice_number) continue;

        const targetInvoice = targetByNumber.get(
            creditNote.credit_for_invoice_number
        );
        if (!targetInvoice) continue;

        const rawCreditAmount =
            Math.abs(creditNote.customer_net_amount ?? 0) ||
            Math.abs(creditNote.customer_amount ?? 0) ||
            Math.abs(creditNote.net_amount ?? 0) ||
            Math.abs(creditNote.amount ?? 0);

        if (rawCreditAmount <= 0) continue;

        try {
            await assignCreditInvoice(prisma, {
                creditInvoiceId: creditNote.id,
                targetInvoiceId: targetInvoice.id,
                creditAmount: rawCreditAmount,
            });
            linkedCount++;
            affectedInvoiceIds.push(targetInvoice.id);
        } catch (error) {
            console.error(
                `Failed to link orphaned credit note ${creditNote.id} to target ${targetInvoice.id}:`,
                error
            );
        }
    }

    return { linkedCount, affectedInvoiceIds };
}
