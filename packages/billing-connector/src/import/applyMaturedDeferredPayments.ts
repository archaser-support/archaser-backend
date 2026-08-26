import type { PrismaClient } from "@prisma/client";
import { linkDeferredPaymentAndRecalc } from "../invoice/linkDeferredPaymentAndRecalc";

export interface MaturityResult {
    matured: number;
    deferredRemaining: number;
}

export async function applyMaturedDeferredPayments(
    prisma: PrismaClient,
    accountId: number,
    asOf: Date,
    invoiceNumbers?: string[]
): Promise<MaturityResult> {
    const scopedNumbers =
        invoiceNumbers == null
            ? null
            : Array.from(
                  new Set(
                      invoiceNumbers.filter((n) => Boolean(n?.trim()))
                  )
              );

    if (scopedNumbers && scopedNumbers.length === 0) {
        return { matured: 0, deferredRemaining: 0 };
    }

    const deferredRows = await prisma.invoicePayment.findMany({
        where: {
            account_id: accountId,
            invoice_id: null,
            payment_date: { lte: asOf },
            invoice_number:
                scopedNumbers == null
                    ? { not: null }
                    : { in: scopedNumbers },
        },
        select: {
            id: true,
            invoice_number: true,
            customer_id: true,
        },
    });

    if (deferredRows.length === 0) {
        const stillDeferred = await prisma.invoicePayment.count({
            where: { account_id: accountId, invoice_id: null },
        });
        return { matured: 0, deferredRemaining: stillDeferred };
    }

    let matured = 0;
    for (const row of deferredRows) {
        if (!row.invoice_number) continue;

        const invoice = await prisma.invoice.findFirst({
            where: {
                account_id: accountId,
                customer_id: row.customer_id,
                invoice_number: row.invoice_number,
            },
            select: { id: true },
        });

        if (!invoice) continue;

        const result = await linkDeferredPaymentAndRecalc(prisma, {
            invoicePaymentId: row.id,
            invoiceId: invoice.id,
        });

        if (!result.alreadyLinked) {
            matured += 1;
        }
    }

    const stillDeferred = await prisma.invoicePayment.count({
        where: { account_id: accountId, invoice_id: null },
    });

    return { matured, deferredRemaining: stillDeferred };
}
