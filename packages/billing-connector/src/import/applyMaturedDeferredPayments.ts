import type { PrismaClient } from "@prisma/client";

import { resolveAccountBillingExtension } from "../extensions";
import type { ExtensionPaymentLinkedCandidate } from "../extensions/types";
import {
    bulkLinkDeferredPayments,
    recalculateInvoicesFromLinkedPayments,
    type BulkDeferredPaymentLink,
} from "../invoice/linkDeferredPaymentAndRecalc";
import { alignPaymentToInvoiceCurrency } from "../payment/alignPaymentToInvoiceCurrency";

export interface MaturityResult {
    matured: number;
    deferredRemaining: number;
    /** Eligible deferred payments considered for linking in this pass. */
    totalCandidates: number;
    /** Customers whose invoices were linked/recalculated in this pass. */
    affectedCustomerIds: number[];
}

export interface MaturityProgress {
    linked: number;
    totalCandidates: number;
    /** Sub-step while linking, extension closes, or paid-total recalc runs. */
    detail?: MaturityProgressDetail;
}

export interface MaturityProgressDetail {
    step: "link" | "close" | "recalc";
    processed?: number;
    total?: number;
}

/**
 * Rebuild a minimal ERP-shaped row for extension hooks after maturity.
 * When reference is FRECONNUM|FNCNUM|KLINE, treat as reconciled (BAL=0).
 * Without a leading recon segment, afterPaymentLinked recon checks no-op.
 */
export function rawErpRowFromMaturedPayment(payment: {
    reference: string;
    customer_amount: number;
    invoice_number: string;
}): Record<string, unknown> {
    const parts = payment.reference
        .split("|")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const raw: Record<string, unknown> = {
        FNCIREF1: payment.invoice_number,
        PAY_INVOICE_NUMBER: payment.invoice_number,
        CREDIT1: payment.customer_amount,
        BAL: 0,
    };
    if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
        raw.FRECONNUM = Number(parts[0]);
        raw.FNCNUM = parts[1];
        raw.KLINE = parts[2];
    }
    return raw;
}

/**
 * Link deferred payments whose invoice now exists and whose payment_date has
 * matured. Matches in memory, bulk-links via UNNEST, runs extension closes,
 * then batch-recalcs paid totals.
 */
export async function applyMaturedDeferredPayments(
    prisma: PrismaClient,
    accountId: number,
    asOf: Date,
    invoiceNumbers?: string[],
    options?: {
        onProgress?: (progress: MaturityProgress) => void;
        userId?: string;
    }
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
        return {
            matured: 0,
            deferredRemaining: 0,
            totalCandidates: 0,
            affectedCustomerIds: [],
        };
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
            reference: true,
            amount: true,
            customer_amount: true,
            customer_currency: true,
            payment_date: true,
        },
    });

    const totalCandidates = deferredRows.length;
    options?.onProgress?.({ linked: 0, totalCandidates });

    if (deferredRows.length === 0) {
        const stillDeferred = await prisma.invoicePayment.count({
            where: { account_id: accountId, invoice_id: null },
        });
        return {
            matured: 0,
            deferredRemaining: stillDeferred,
            totalCandidates: 0,
            affectedCustomerIds: [],
        };
    }

    const customerIds = [
        ...new Set(deferredRows.map((row) => row.customer_id)),
    ];
    const deferredInvoiceNumbers = [
        ...new Set(
            deferredRows
                .map((row) => row.invoice_number)
                .filter((n): n is string => Boolean(n))
        ),
    ];

    const invoices =
        customerIds.length === 0 || deferredInvoiceNumbers.length === 0
            ? []
            : await prisma.invoice.findMany({
                  where: {
                      account_id: accountId,
                      customer_id: { in: customerIds },
                      invoice_number: { in: deferredInvoiceNumbers },
                  },
                  select: {
                      id: true,
                      customer_id: true,
                      invoice_number: true,
                      amount: true,
                      customer_amount: true,
                      customer_currency: true,
                  },
              });

    const invoiceByCustomerAndNumber = new Map<
        string,
        (typeof invoices)[number]
    >();
    for (const invoice of invoices) {
        if (!invoice.invoice_number) continue;
        invoiceByCustomerAndNumber.set(
            `${invoice.customer_id}::${invoice.invoice_number}`,
            invoice
        );
    }

    const extension = await resolveAccountBillingExtension(prisma, accountId);
    const currencyOptions = extension?.normalizePaymentCurrency
        ? { normalizeCurrency: extension.normalizePaymentCurrency }
        : undefined;

    const now = new Date();
    const bulkLinks: BulkDeferredPaymentLink[] = [];
    const linkCandidates: ExtensionPaymentLinkedCandidate[] = [];

    for (const row of deferredRows) {
        if (!row.invoice_number) continue;
        const invoice = invoiceByCustomerAndNumber.get(
            `${row.customer_id}::${row.invoice_number}`
        );
        if (invoice == null) continue;
        const invoiceId = invoice.id;

        const alignment = alignPaymentToInvoiceCurrency(
            row,
            invoice,
            currencyOptions
        );
        if (alignment) {
            bulkLinks.push({
                paymentId: row.id,
                invoiceId,
                amount: alignment.amount,
                customer_amount: alignment.customer_amount,
                customer_currency: alignment.customer_currency,
            });
        } else {
            bulkLinks.push({
                paymentId: row.id,
                invoiceId,
            });
        }
        linkCandidates.push({
            invoiceId,
            customerId: row.customer_id,
            invoiceNumber: row.invoice_number,
            paymentDate: row.payment_date,
            rawErpRow: rawErpRowFromMaturedPayment({
                reference: row.reference,
                customer_amount: row.customer_amount,
                invoice_number: row.invoice_number,
            }),
        });
    }

    let matured = 0;
    let lastProgressAt = 0;
    let progressDetail: MaturityProgressDetail | undefined;
    const emitProgress = (force = false) => {
        const nowMs = Date.now();
        if (
            !force &&
            nowMs - lastProgressAt < 250 &&
            matured < totalCandidates
        ) {
            return;
        }
        lastProgressAt = nowMs;
        options?.onProgress?.({
            linked: matured,
            totalCandidates,
            ...(progressDetail ? { detail: progressDetail } : {}),
        });
    };

    const invoiceIdsToRecalc = new Map<number, Record<string, never>>();

    if (bulkLinks.length > 0) {
        progressDetail = { step: "link", total: bulkLinks.length };
        emitProgress(true);
        let linkedSoFar = 0;
        matured = await bulkLinkDeferredPayments(
            prisma,
            accountId,
            bulkLinks,
            now,
            {
                onChunkLinked: (count) => {
                    linkedSoFar += count;
                    progressDetail = {
                        step: "link",
                        processed: Math.min(linkedSoFar, bulkLinks.length),
                        total: bulkLinks.length,
                    };
                    emitProgress();
                },
            }
        );
        for (const link of bulkLinks) {
            invoiceIdsToRecalc.set(link.invoiceId, {});
        }
        progressDetail = undefined;
        emitProgress(true);

        if (extension?.afterPaymentLinked && linkCandidates.length > 0) {
            progressDetail = {
                step: "close",
                total: linkCandidates.length,
            };
            emitProgress(true);
            const {
                invoiceIdsToRecalc: extensionRecalcIds,
                invoiceIdsSkipRecalc: extensionSkipIds,
            } = await extension.afterPaymentLinked({
                prisma,
                accountId,
                userId: options?.userId,
                candidates: linkCandidates,
            });
            for (const invoiceId of extensionRecalcIds) {
                invoiceIdsToRecalc.set(invoiceId, {});
            }
            for (const invoiceId of extensionSkipIds ?? []) {
                invoiceIdsToRecalc.delete(invoiceId);
            }
        }

        await recalculateInvoicesFromLinkedPayments(
            prisma,
            invoiceIdsToRecalc,
            {
                onProgress: ({ processed, total }) => {
                    progressDetail = { step: "recalc", processed, total };
                    emitProgress(processed === 0 || processed === total);
                },
            }
        );
        progressDetail = undefined;
        emitProgress(true);
    }

    const stillDeferred = await prisma.invoicePayment.count({
        where: { account_id: accountId, invoice_id: null },
    });

    const affectedCustomerIds =
        invoiceIdsToRecalc.size > 0
            ? Array.from(
                  new Set(
                      linkCandidates.map((candidate) => candidate.customerId)
                  )
              )
            : [];

    return {
        matured,
        deferredRemaining: stillDeferred,
        totalCandidates,
        affectedCustomerIds,
    };
}
