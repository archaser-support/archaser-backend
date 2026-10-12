import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { resolveAccountBillingExtension } from "../extensions";
import type { ExtensionPaymentLinkedCandidate } from "../extensions/types";
import {
    bulkLinkDeferredPayments,
    recalculateInvoicesFromLinkedPayments,
    type BulkDeferredPaymentLink,
    type InvoicePaidRecalcOptions,
} from "../invoice/linkDeferredPaymentAndRecalc";
import { findManyInChunks } from "./prismaInChunks";
import { alignPaymentToInvoiceCurrency } from "../payment/alignPaymentToInvoiceCurrency";
import { toMoneyNumber } from "../payment/moneyNumber";
import { isVirtualPaymentMethod } from "../payment/virtualPaymentTrim";

export interface MaturityResult {
    matured: number;
    deferredRemaining: number;
    /** Eligible deferred payments considered for linking in this pass. */
    totalCandidates: number;
    /** Customers whose invoices were linked/recalculated in this pass. */
    affectedCustomerIds: number[];
    /** Invoices recalculated in this pass (as-of rewrite / live gap scope). */
    affectedInvoiceIds: number[];
}

export interface MaturityProgress {
    linked: number;
    totalCandidates: number;
    /** Sub-step while linking, extension closes, or paid-total recalc runs. */
    detail?: MaturityProgressDetail;
}

export interface MaturityProgressDetail {
    step: "prepare" | "link" | "close" | "recalc";
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
 * Open invoices whose stored paid totals drift from payments effective as of
 * `asOf` (linked rows with `payment_date <= asOf`). Used so already-linked
 * future payments settle on maturity without a new schema marker.
 */
async function findOpenInvoiceIdsNeedingAsOfSettle(
    prisma: PrismaClient,
    accountId: number,
    asOf: Date,
    invoiceNumbers?: string[] | null
): Promise<number[]> {
    const rows =
        invoiceNumbers == null
            ? await prisma.$queryRaw<Array<{ id: number }>>`
                SELECT i.id
                FROM "Invoice" i
                INNER JOIN "InvoicePayment" p ON p.invoice_id = i.id
                WHERE i.account_id = ${accountId}
                  AND i.status NOT IN (
                      'Paid'::"invoice_status",
                      'Void'::"invoice_status",
                      'Cancelled'::"invoice_status"
                  )
                  AND p.payment_date <= ${asOf}
                GROUP BY i.id, i.total_paid, i.customer_total_paid
                HAVING (
                    ABS(
                        COALESCE(SUM(p.amount), 0) - COALESCE(i.total_paid, 0)
                    ) > 0.001
                    OR ABS(
                        COALESCE(SUM(p.customer_amount), 0)
                            - COALESCE(i.customer_total_paid, 0)
                    ) > 0.001
                )
            `
            : await prisma.$queryRaw<Array<{ id: number }>>`
                SELECT i.id
                FROM "Invoice" i
                INNER JOIN "InvoicePayment" p ON p.invoice_id = i.id
                WHERE i.account_id = ${accountId}
                  AND i.status NOT IN (
                      'Paid'::"invoice_status",
                      'Void'::"invoice_status",
                      'Cancelled'::"invoice_status"
                  )
                  AND p.payment_date <= ${asOf}
                  AND i.invoice_number IN (${Prisma.join(invoiceNumbers)})
                GROUP BY i.id, i.total_paid, i.customer_total_paid
                HAVING (
                    ABS(
                        COALESCE(SUM(p.amount), 0) - COALESCE(i.total_paid, 0)
                    ) > 0.001
                    OR ABS(
                        COALESCE(SUM(p.customer_amount), 0)
                            - COALESCE(i.customer_total_paid, 0)
                    ) > 0.001
                )
            `;

    return rows.map((row) => row.id);
}

/**
 * Build afterPaymentLinked candidates for open invoices whose linked cash is
 * now effective — used to re-run recon virtual close after a future FNCDATE.
 */
async function buildMaturedReconcileCloseCandidates(
    prisma: PrismaClient,
    invoiceIds: number[]
): Promise<ExtensionPaymentLinkedCandidate[]> {
    if (invoiceIds.length === 0) {
        return [];
    }

    const [invoices, payments] = await Promise.all([
        findManyInChunks(invoiceIds, (chunk) =>
            prisma.invoice.findMany({
                where: { id: { in: chunk } },
                select: {
                    id: true,
                    customer_id: true,
                    invoice_number: true,
                },
            })
        ),
        findManyInChunks(invoiceIds, (chunk) =>
            prisma.invoicePayment.findMany({
                where: { invoice_id: { in: chunk } },
                select: {
                    invoice_id: true,
                    customer_id: true,
                    invoice_number: true,
                    payment_date: true,
                    payment_method: true,
                    reference: true,
                    customer_amount: true,
                },
            })
        ),
    ]);

    const invoiceById = new Map(invoices.map((row) => [row.id, row]));
    const bestByInvoice = new Map<
        number,
        (typeof payments)[number]
    >();

    for (const payment of payments) {
        if (payment.invoice_id == null) continue;
        if (isVirtualPaymentMethod(payment.payment_method)) continue;
        if (!payment.reference?.trim()) continue;
        const existing = bestByInvoice.get(payment.invoice_id);
        if (
            !existing ||
            payment.payment_date.getTime() > existing.payment_date.getTime()
        ) {
            bestByInvoice.set(payment.invoice_id, payment);
        }
    }

    const candidates: ExtensionPaymentLinkedCandidate[] = [];
    for (const [invoiceId, payment] of bestByInvoice) {
        const invoice = invoiceById.get(invoiceId);
        if (!invoice?.invoice_number || invoice.customer_id == null) continue;
        candidates.push({
            invoiceId,
            customerId: invoice.customer_id,
            invoiceNumber: invoice.invoice_number,
            paymentDate: payment.payment_date,
            rawErpRow: rawErpRowFromMaturedPayment({
                reference: payment.reference ?? "",
                customer_amount: toMoneyNumber(payment.customer_amount),
                invoice_number: invoice.invoice_number,
            }),
        });
    }
    return candidates;
}

/**
 * Link deferred payments whose invoice now exists and whose payment_date has
 * matured. Also recalculate open invoices whose linked payments become
 * effective as of `asOf` (settle gate for future-dated linked cash).
 * Matches in memory, bulk-links via UNNEST, runs extension closes,
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
            affectedInvoiceIds: [],
        };
    }

    let matured = 0;
    let totalCandidates = 0;
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

    progressDetail = { step: "prepare" };
    emitProgress(true);

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

    totalCandidates = deferredRows.length;
    progressDetail = {
        step: "prepare",
        processed: 0,
        total: totalCandidates,
    };
    emitProgress(true);

    const invoiceIdsToRecalc = new Map<number, InvoicePaidRecalcOptions>();
    const recalcOptions: InvoicePaidRecalcOptions = { asOf };
    const linkCandidates: ExtensionPaymentLinkedCandidate[] = [];
    const now = new Date();
    const extension = await resolveAccountBillingExtension(prisma, accountId);

    if (deferredRows.length > 0) {
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

        progressDetail = {
            step: "prepare",
            processed: Math.min(1, totalCandidates),
            total: totalCandidates,
        };
        emitProgress(true);

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

        const currencyOptions = extension?.normalizePaymentCurrency
            ? { normalizeCurrency: extension.normalizePaymentCurrency }
            : undefined;

        const bulkLinks: BulkDeferredPaymentLink[] = [];

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
                    customer_amount: toMoneyNumber(row.customer_amount),
                    invoice_number: row.invoice_number,
                }),
            });
        }

        progressDetail = {
            step: "prepare",
            processed: bulkLinks.length,
            total: totalCandidates,
        };
        emitProgress(true);

        if (bulkLinks.length > 0) {
            progressDetail = {
                step: "link",
                processed: 0,
                total: bulkLinks.length,
            };
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
                        // Keep bar `linked` in sync with chunks — matured was only
                        // assigned after the await, so the UI jumped once at the end.
                        matured = Math.min(linkedSoFar, bulkLinks.length);
                        progressDetail = {
                            step: "link",
                            processed: matured,
                            total: bulkLinks.length,
                        };
                        emitProgress();
                    },
                }
            );
            for (const link of bulkLinks) {
                invoiceIdsToRecalc.set(link.invoiceId, recalcOptions);
            }
            progressDetail = {
                step: "link",
                processed: bulkLinks.length,
                total: bulkLinks.length,
            };
            emitProgress(true);

            if (extension?.afterPaymentLinked && linkCandidates.length > 0) {
                progressDetail = {
                    step: "close",
                    processed: 0,
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
                    asOf,
                    onProgress: ({ processed, total }) => {
                        progressDetail = {
                            step: "close",
                            processed,
                            total,
                        };
                        emitProgress();
                    },
                });
                for (const invoiceId of extensionRecalcIds) {
                    invoiceIdsToRecalc.set(invoiceId, recalcOptions);
                }
                for (const invoiceId of extensionSkipIds ?? []) {
                    invoiceIdsToRecalc.delete(invoiceId);
                }
                progressDetail = {
                    step: "close",
                    processed: linkCandidates.length,
                    total: linkCandidates.length,
                };
                emitProgress(true);
            }
        }
    }

    // Already-linked future cash that crossed asOf — settle via shared recalc.
    const settleInvoiceIds = await findOpenInvoiceIdsNeedingAsOfSettle(
        prisma,
        accountId,
        asOf,
        scopedNumbers
    );
    for (const invoiceId of settleInvoiceIds) {
        invoiceIdsToRecalc.set(invoiceId, recalcOptions);
    }

    // Re-run 10149 recon virtual close for invoices whose covering cash just
    // became effective (import-day flush skipped while FNCDATE was future).
    if (extension?.afterPaymentLinked && settleInvoiceIds.length > 0) {
        const settleCloseCandidates =
            await buildMaturedReconcileCloseCandidates(
                prisma,
                settleInvoiceIds
            );
        if (settleCloseCandidates.length > 0) {
            progressDetail = {
                step: "close",
                processed: 0,
                total: settleCloseCandidates.length,
            };
            emitProgress(true);
            const {
                invoiceIdsToRecalc: extensionRecalcIds,
                invoiceIdsSkipRecalc: extensionSkipIds,
            } = await extension.afterPaymentLinked({
                prisma,
                accountId,
                userId: options?.userId,
                candidates: settleCloseCandidates,
                asOf,
                onProgress: ({ processed, total }) => {
                    progressDetail = {
                        step: "close",
                        processed,
                        total,
                    };
                    emitProgress();
                },
            });
            for (const invoiceId of extensionRecalcIds) {
                invoiceIdsToRecalc.set(invoiceId, recalcOptions);
            }
            for (const invoiceId of extensionSkipIds ?? []) {
                invoiceIdsToRecalc.delete(invoiceId);
            }
            progressDetail = {
                step: "close",
                processed: settleCloseCandidates.length,
                total: settleCloseCandidates.length,
            };
            emitProgress(true);
        }
    }

    if (invoiceIdsToRecalc.size > 0) {
        await recalculateInvoicesFromLinkedPayments(
            prisma,
            invoiceIdsToRecalc,
            {
                onProgress: ({ processed, total }) => {
                    progressDetail = { step: "recalc", processed, total };
                    emitProgress(true);
                },
            }
        );
        progressDetail = undefined;
        emitProgress(true);
    }

    const stillDeferred = await prisma.invoicePayment.count({
        where: { account_id: accountId, invoice_id: null },
    });

    let affectedCustomerIds: number[] = [];
    if (invoiceIdsToRecalc.size > 0) {
        const fromLinks = linkCandidates.map(
            (candidate) => candidate.customerId
        );
        if (settleInvoiceIds.length > 0) {
            const settleCustomers = await prisma.invoice.findMany({
                where: { id: { in: settleInvoiceIds } },
                select: { customer_id: true },
            });
            affectedCustomerIds = Array.from(
                new Set([
                    ...fromLinks,
                    ...settleCustomers
                        .map((row) => row.customer_id)
                        .filter((id): id is number => id != null),
                ])
            );
        } else {
            affectedCustomerIds = Array.from(new Set(fromLinks));
        }
    }

    return {
        matured,
        deferredRemaining: stillDeferred,
        totalCandidates,
        affectedCustomerIds,
        affectedInvoiceIds: Array.from(invoiceIdsToRecalc.keys()),
    };
}
