import type { PrismaClient } from "@prisma/client";
import { collectPaymentReferenceAliases } from "../payment/connectorPaymentSynthetics";
import { recalculateInvoicesFromLinkedPayments } from "../invoice/linkDeferredPaymentAndRecalc";
import { parseErpDateOnly } from "../utils/connectorFieldUtils";
import { commitOps, lastWinsByKey } from "./bulkWrite";
import {
    resolveAccountBillingExtension,
    type BillingAccountExtension,
    type ExtensionPaymentLinkedCandidate,
} from "../extensions";
import type { InvoicePaymentInput } from "./normalizePaymentInput";
import { resolvePaymentImportAmounts } from "./resolvePaymentImportAmounts";

export interface ImportPaymentResult {
    index: number;
    success: boolean;
    skipped?: boolean;
    deferred?: boolean;
    invoicePaymentId?: number;
    customerId?: number;
    message?: string;
}

type ExistingPaymentRow = {
    id: number;
    reference: string;
    amount: number;
    customer_amount: number;
    customer_currency: string;
    payment_date: Date;
    invoice_id: number | null;
    invoice_number: string | null;
    payment_method: string;
};

function resolveDeferredPaymentAmounts(record: InvoicePaymentInput): {
    amount: number;
    customer_amount: number;
    customer_currency: string;
} {
    const customer_amount = record.customer_amount;
    const customer_currency = record.customer_currency.trim();

    if (record.amount !== undefined && Number.isFinite(record.amount)) {
        return { amount: record.amount, customer_amount, customer_currency };
    }

    return { amount: customer_amount, customer_amount, customer_currency };
}

function sameCalendarDay(a: Date, b: Date): boolean {
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/** InvoicePayment amounts are Postgres Real (float32); ERP values are JS float64. */
function sameRealAmount(existing: number, next: number): boolean {
    return existing === next || Math.fround(existing) === Math.fround(next);
}

function isUnchangedPayment(
    existing: ExistingPaymentRow,
    next: {
        amount: number;
        customer_amount: number;
        customer_currency: string;
        payment_date: Date;
        reference: string;
        invoice_id: number | null;
        invoice_number: string;
        payment_method: string;
    }
): boolean {
    const existingInvoiceNumber = (existing.invoice_number ?? "").trim();
    const nextInvoiceNumber = next.invoice_number.trim();
    const sameLink = existing.invoice_id === next.invoice_id;
    return (
        sameRealAmount(existing.amount, next.amount) &&
        sameRealAmount(existing.customer_amount, next.customer_amount) &&
        existing.customer_currency === next.customer_currency &&
        sameCalendarDay(existing.payment_date, next.payment_date) &&
        existing.reference === next.reference &&
        sameLink &&
        existingInvoiceNumber === nextInvoiceNumber &&
        (existing.payment_method ?? "") === next.payment_method
    );
}

function erpRowFromRecord(record: InvoicePaymentInput): Record<string, unknown> {
    return record._rawRecord ?? (record as unknown as Record<string, unknown>);
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function matchExistingPayment(
    rows: ExistingPaymentRow[],
    uniqueAliases: string[],
    rawReference: string,
    targetInvoiceNumber: string,
    effectiveReference: string
): ExistingPaymentRow | null {
    const exact = rows.find((row) => row.reference === effectiveReference);
    if (exact) return exact;

    for (const alias of uniqueAliases) {
        if (!alias.includes("|") || alias === effectiveReference) continue;
        const hit = rows.find((row) => row.reference === alias);
        if (hit) return hit;
    }

    if (targetInvoiceNumber) {
        const byRawAndInvoice = rows.find(
            (row) =>
                row.reference === rawReference &&
                (row.invoice_number ?? "").trim() === targetInvoiceNumber
        );
        if (byRawAndInvoice) return byRawAndInvoice;
    }

    const aliasSet = new Set(uniqueAliases);
    return rows.find((row) => aliasSet.has(row.reference)) ?? null;
}

export async function importPayments(
    prisma: PrismaClient,
    paymentRecords: InvoicePaymentInput[],
    accountId: number,
    userId?: string,
    options?: { extension?: BillingAccountExtension }
): Promise<ImportPaymentResult[]> {
    const results: ImportPaymentResult[] = paymentRecords.map((_, index) => ({
        index,
        success: false,
    }));
    const extension =
        options?.extension ??
        (await resolveAccountBillingExtension(prisma, accountId));

    const customerNumbers = [
        ...new Set(paymentRecords.map((p) => p.customer_number)),
    ];
    const customers = await prisma.customer.findMany({
        where: {
            account_id: accountId,
            customer_number: { in: customerNumbers },
        },
        select: { id: true, customer_number: true },
    });
    const customerByNumber = new Map<string, number>();
    for (const c of customers) {
        if (c.customer_number) {
            customerByNumber.set(c.customer_number, c.id);
        }
    }

    type PreparedPayment = {
        index: number;
        record: InvoicePaymentInput;
        customerId: number;
        rawReference: string;
        effectiveReference: string;
        uniqueAliases: string[];
        targetInvoiceNumber: string;
        paymentDate: Date;
        paymentMethod: string;
    };

    const prepared: PreparedPayment[] = [];

    for (let i = 0; i < paymentRecords.length; i++) {
        const record = { ...paymentRecords[i], account_id: accountId };
        const customerId = customerByNumber.get(record.customer_number);
        if (customerId === undefined) {
            results[i] = {
                index: i,
                success: false,
                message: `Customer ${record.customer_number} not found`,
            };
            continue;
        }
        if (!record.reference) {
            results[i] = {
                index: i,
                success: false,
                message: "Reference ID is required",
            };
            continue;
        }

        const targetInvoiceNumber =
            record.invoice_number?.trim() ||
            asNonEmptyString(
                (record as InvoicePaymentInput & { FNCIREF1?: string }).FNCIREF1
            ) ||
            "";
        const rawReference = record.reference.trim();
        const shouldCompositeRef =
            targetInvoiceNumber.length > 0 &&
            !rawReference.includes("|") &&
            rawReference !== targetInvoiceNumber;
        const effectiveReference = shouldCompositeRef
            ? `${rawReference}|${targetInvoiceNumber}`
            : rawReference;
        record.reference = effectiveReference;
        const aliases = collectPaymentReferenceAliases(
            erpRowFromRecord(record),
            effectiveReference,
            targetInvoiceNumber
        );
        const paymentDate =
            parseErpDateOnly(record.payment_date) ??
            parseErpDateOnly(String(record.payment_date ?? "").slice(0, 10));
        if (!paymentDate) {
            results[i] = {
                index: i,
                success: false,
                message: "import.validation.paymentDateRequired",
            };
            continue;
        }
        prepared.push({
            index: i,
            record,
            customerId,
            rawReference,
            effectiveReference,
            uniqueAliases: aliases.length > 0 ? aliases : [effectiveReference],
            targetInvoiceNumber,
            paymentDate,
            paymentMethod: record.payment_method ?? "",
        });
    }

    const winners = lastWinsByKey(
        prepared,
        (row) => `${row.customerId}::${row.effectiveReference}`
    );
    if (winners.length === 0) {
        return results;
    }

    const customerIds = [...new Set(winners.map((row) => row.customerId))];
    const invoiceNumbers = [
        ...new Set(
            winners
                .map((row) => row.targetInvoiceNumber)
                .filter((n) => n.length > 0)
        ),
    ];
    const allAliases = [
        ...new Set(winners.flatMap((row) => row.uniqueAliases)),
    ];

    const [invoices, existingPayments] = await Promise.all([
        invoiceNumbers.length === 0
            ? Promise.resolve([])
            : prisma.invoice.findMany({
                  where: {
                      invoice_number: { in: invoiceNumbers },
                      customer_id: { in: customerIds },
                  },
                  select: {
                      id: true,
                      amount: true,
                      customer_amount: true,
                      customer_currency: true,
                      invoice_number: true,
                      custom_code1: true,
                      customer_id: true,
                  },
              }),
        customerIds.length === 0
            ? Promise.resolve([])
            : prisma.invoicePayment.findMany({
                  where: {
                      account_id: accountId,
                      customer_id: { in: customerIds },
                      OR: [
                          { reference: { in: allAliases } },
                          ...(invoiceNumbers.length > 0
                              ? [{ invoice_number: { in: invoiceNumbers } }]
                              : []),
                      ],
                  },
                  select: {
                      id: true,
                      reference: true,
                      amount: true,
                      customer_amount: true,
                      customer_currency: true,
                      payment_date: true,
                      invoice_id: true,
                      invoice_number: true,
                      payment_method: true,
                      customer_id: true,
                  },
              }),
    ]);

    const invoiceByCustomerNumber = new Map<
        string,
        (typeof invoices)[number]
    >();
    for (const invoice of invoices) {
        if (invoice.invoice_number && invoice.customer_id != null) {
            invoiceByCustomerNumber.set(
                `${invoice.customer_id}::${invoice.invoice_number}`,
                invoice
            );
        }
    }

    const existingByCustomer = new Map<number, ExistingPaymentRow[]>();
    for (const row of existingPayments as Array<
        ExistingPaymentRow & { customer_id: number }
    >) {
        const list = existingByCustomer.get(row.customer_id) ?? [];
        list.push(row);
        existingByCustomer.set(row.customer_id, list);
    }

    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{
        id: number;
        data: Record<string, unknown>;
        previousInvoiceId: number | null;
        newInvoiceId: number | null;
        normalizeNegative?: boolean;
        winner: PreparedPayment;
        deferred: boolean;
    }> = [];
    const createdMeta: Array<{
        winner: PreparedPayment;
        deferred: boolean;
        invoiceId: number | null;
        normalizeNegative?: boolean;
    }> = [];
    const skippedIds = new Map<string, ImportPaymentResult>();
    const failedIds = new Map<string, ImportPaymentResult>();
    const invoiceIdsToRecalc = new Map<
        number,
        {
            normalizeNegativePaymentsForCreditClose?: boolean;
            isForcePaidClose?: BillingAccountExtension["isForcePaidClose"];
        }
    >();

    const markRecalc = (
        invoiceId: number | null,
        normalizeNegative?: boolean
    ) => {
        if (invoiceId == null) return;
        const prev = invoiceIdsToRecalc.get(invoiceId) ?? {};
        invoiceIdsToRecalc.set(invoiceId, {
            normalizeNegativePaymentsForCreditClose:
                prev.normalizeNegativePaymentsForCreditClose === true ||
                normalizeNegative === true,
            isForcePaidClose: extension?.isForcePaidClose,
        });
    };

    const afterLinkCandidates: ExtensionPaymentLinkedCandidate[] = [];
    const queueAfterPaymentLinked = (
        winner: PreparedPayment,
        invoiceId: number | null
    ) => {
        if (
            invoiceId == null ||
            !winner.targetInvoiceNumber ||
            !extension?.afterPaymentLinked
        ) {
            return;
        }
        afterLinkCandidates.push({
            invoiceId,
            customerId: winner.customerId,
            invoiceNumber: winner.targetInvoiceNumber,
            paymentDate: winner.paymentDate,
            rawErpRow: erpRowFromRecord(winner.record),
        });
    };

    for (const winner of winners) {
        const key = `${winner.customerId}::${winner.effectiveReference}`;
        const existingPayment = matchExistingPayment(
            existingByCustomer.get(winner.customerId) ?? [],
            winner.uniqueAliases,
            winner.rawReference,
            winner.targetInvoiceNumber,
            winner.effectiveReference
        );
        const invoice = invoiceByCustomerNumber.get(
            `${winner.customerId}::${winner.targetInvoiceNumber}`
        );

        if (!invoice) {
            const deferredAmounts = resolveDeferredPaymentAmounts(winner.record);
            const nextSnapshot = {
                amount: deferredAmounts.amount,
                customer_amount: deferredAmounts.customer_amount,
                customer_currency: deferredAmounts.customer_currency,
                payment_date: winner.paymentDate,
                reference: winner.effectiveReference,
                invoice_id: existingPayment?.invoice_id ?? null,
                invoice_number: winner.targetInvoiceNumber,
                payment_method: winner.paymentMethod,
            };
            if (existingPayment) {
                if (isUnchangedPayment(existingPayment, nextSnapshot)) {
                    skippedIds.set(key, {
                        index: winner.index,
                        success: true,
                        skipped: true,
                        invoicePaymentId: existingPayment.id,
                        customerId: winner.customerId,
                        message: "import.results.paymentSkipped",
                    });
                    continue;
                }
                updates.push({
                    id: existingPayment.id,
                    previousInvoiceId: existingPayment.invoice_id,
                    newInvoiceId: existingPayment.invoice_id,
                    winner,
                    deferred: existingPayment.invoice_id == null,
                    data: {
                        invoice_id: existingPayment.invoice_id,
                        invoice_number: winner.targetInvoiceNumber || null,
                        customer_currency: deferredAmounts.customer_currency,
                        payment_date: winner.paymentDate,
                        amount: deferredAmounts.amount,
                        payment_method: winner.paymentMethod,
                        reference: winner.effectiveReference,
                        customer_amount: deferredAmounts.customer_amount,
                        modified_by: userId ?? null,
                        modified_at: new Date(),
                    },
                });
                continue;
            }
            inserts.push({
                invoice_id: null,
                invoice_number: winner.targetInvoiceNumber || null,
                customer_currency: deferredAmounts.customer_currency,
                payment_date: winner.paymentDate,
                amount: deferredAmounts.amount,
                payment_method: winner.paymentMethod,
                reference: winner.record.reference,
                customer_id: winner.customerId,
                account_id: accountId,
                customer_amount: deferredAmounts.customer_amount,
                created_by: userId ?? null,
                modified_by: userId ?? null,
            });
            createdMeta.push({
                winner,
                deferred: true,
                invoiceId: null,
            });
            continue;
        }

        const currencyOptions = extension?.normalizePaymentCurrency
            ? { normalizeCurrency: extension.normalizePaymentCurrency }
            : undefined;
        const invoiceAmountContext = {
            amount: invoice.amount,
            customer_amount: invoice.customer_amount,
            customer_currency: invoice.customer_currency,
        };
        const rawErpRow = erpRowFromRecord(winner.record);
        const paymentAmountRow = {
            amount: winner.record.amount,
            customer_amount: winner.record.customer_amount,
            customer_currency: winner.record.customer_currency,
        };
        const alignedRow =
            extension?.alignPaymentAmountsForInvoice?.({
                ...paymentAmountRow,
                invoiceCustomerCurrency: invoice.customer_currency,
                rawErpRow,
            }) ?? paymentAmountRow;
        const amountResolution = resolvePaymentImportAmounts(
            alignedRow,
            invoiceAmountContext,
            currencyOptions
        );
        if (!amountResolution.ok) {
            console.warn("[importPayments] payment amount resolution failed", {
                errorKey: amountResolution.errorKey,
                accountId,
                extensionKey: extension?.key ?? null,
                paymentIndex: winner.index,
                customerNumber: winner.record.customer_number,
                customerId: winner.customerId,
                invoiceNumber: winner.targetInvoiceNumber,
                invoiceId: invoice.id,
                paymentReference: winner.effectiveReference,
                invoiceCustomerCurrency: invoice.customer_currency,
                invoiceAmount: invoice.amount,
                invoiceCustomerAmount: invoice.customer_amount,
                mappedAmount: paymentAmountRow.amount,
                mappedCustomerAmount: paymentAmountRow.customer_amount,
                mappedCustomerCurrency: paymentAmountRow.customer_currency,
                alignedAmount: alignedRow.amount,
                alignedCustomerAmount: alignedRow.customer_amount,
                alignedCustomerCurrency: alignedRow.customer_currency,
                alignmentChanged:
                    alignedRow.amount !== paymentAmountRow.amount ||
                    alignedRow.customer_amount !==
                        paymentAmountRow.customer_amount ||
                    alignedRow.customer_currency !==
                        paymentAmountRow.customer_currency,
                rawCODE: rawErpRow.CODE ?? null,
                rawCODE5: rawErpRow.CODE5 ?? null,
                rawCREDIT1: rawErpRow.CREDIT1 ?? null,
                rawCREDIT5: rawErpRow.CREDIT5 ?? null,
                rawDEBIT1: rawErpRow.DEBIT1 ?? null,
                rawDEBIT5: rawErpRow.DEBIT5 ?? null,
                rawCURDATE: rawErpRow.CURDATE ?? null,
            });
            failedIds.set(key, {
                index: winner.index,
                success: false,
                message: amountResolution.errorKey,
            });
            continue;
        }

        const normalizeNegative =
            extension?.shouldNormalizeNegativeCreditPayments?.({
                rawErpRow,
                invoiceCustomCode1: invoice.custom_code1,
                customerAmount: amountResolution.customer_amount,
            }) === true;
        const nextSnapshot = {
            amount: amountResolution.amount,
            customer_amount: amountResolution.customer_amount,
            customer_currency: amountResolution.customer_currency,
            payment_date: winner.paymentDate,
            reference: winner.effectiveReference,
            invoice_id: invoice.id,
            invoice_number: winner.targetInvoiceNumber,
            payment_method: winner.paymentMethod,
        };

        if (existingPayment) {
            if (isUnchangedPayment(existingPayment, nextSnapshot)) {
                skippedIds.set(key, {
                    index: winner.index,
                    success: true,
                    skipped: true,
                    invoicePaymentId: existingPayment.id,
                    customerId: winner.customerId,
                    message: "import.results.paymentSkipped",
                });
                queueAfterPaymentLinked(winner, invoice.id);
                // Recon force-paid / virtual close still need a recalc pass.
                markRecalc(invoice.id, normalizeNegative);
                continue;
            }
            updates.push({
                id: existingPayment.id,
                previousInvoiceId: existingPayment.invoice_id,
                newInvoiceId: invoice.id,
                winner,
                deferred: false,
                normalizeNegative,
                data: {
                    invoice_id: invoice.id,
                    invoice_number: winner.targetInvoiceNumber || null,
                    customer_currency: amountResolution.customer_currency,
                    payment_date: winner.paymentDate,
                    amount: amountResolution.amount,
                    payment_method: winner.paymentMethod,
                    reference: winner.effectiveReference,
                    customer_amount: amountResolution.customer_amount,
                    modified_by: userId ?? null,
                    modified_at: new Date(),
                },
            });
            queueAfterPaymentLinked(winner, invoice.id);
            continue;
        }

        inserts.push({
            invoice_id: invoice.id,
            invoice_number: winner.targetInvoiceNumber || null,
            amount: amountResolution.amount,
            payment_date: winner.paymentDate,
            payment_method: winner.paymentMethod,
            reference: winner.record.reference,
            customer_id: winner.customerId,
            account_id: accountId,
            customer_currency: amountResolution.customer_currency,
            customer_amount: amountResolution.customer_amount,
            created_by: userId ?? null,
            modified_by: userId ?? null,
        });
        createdMeta.push({
            winner,
            deferred: false,
            invoiceId: invoice.id,
            normalizeNegative,
        });
        queueAfterPaymentLinked(winner, invoice.id);
    }

    if (inserts.length > 0) {
        await prisma.invoicePayment.createMany({ data: inserts as never });
    }
    if (updates.length > 0) {
        await commitOps(
            prisma,
            updates.map((row) =>
                prisma.invoicePayment.update({
                    where: { id: row.id },
                    data: row.data as never,
                })
            )
        );
    }

    const createdPayments =
        inserts.length === 0
            ? []
            : await prisma.invoicePayment.findMany({
                  where: {
                      account_id: accountId,
                      reference: {
                          in: createdMeta.map(
                              (row) => row.winner.effectiveReference
                          ),
                      },
                      customer_id: { in: customerIds },
                  },
                  select: { id: true, reference: true, customer_id: true },
              });

    const createdIdByKey = new Map<string, number>();
    for (const row of createdPayments) {
        createdIdByKey.set(`${row.customer_id}::${row.reference}`, row.id);
    }

    const winnerResult = new Map<string, ImportPaymentResult>();
    for (const [key, skipped] of skippedIds) {
        winnerResult.set(key, skipped);
    }
    for (const [key, failed] of failedIds) {
        winnerResult.set(key, failed);
    }
    for (const row of createdMeta) {
        const key = `${row.winner.customerId}::${row.winner.effectiveReference}`;
        const invoicePaymentId = createdIdByKey.get(key);
        winnerResult.set(key, {
            index: row.winner.index,
            success: true,
            deferred: row.deferred,
            invoicePaymentId,
            customerId: row.winner.customerId,
            message: row.deferred ? "import.results.paymentDeferred" : undefined,
        });
        markRecalc(row.invoiceId, row.normalizeNegative);
    }
    for (const row of updates) {
        const key = `${row.winner.customerId}::${row.winner.effectiveReference}`;
        winnerResult.set(key, {
            index: row.winner.index,
            success: true,
            deferred: row.deferred,
            invoicePaymentId: row.id,
            customerId: row.winner.customerId,
            message: row.deferred ? "import.results.paymentDeferred" : undefined,
        });
        markRecalc(row.previousInvoiceId, row.normalizeNegative);
        markRecalc(row.newInvoiceId, row.normalizeNegative);
    }

    if (
        extension?.afterPaymentLinked &&
        afterLinkCandidates.length > 0
    ) {
        const {
            invoiceIdsToRecalc: extensionRecalcIds,
            invoiceIdsSkipRecalc: extensionSkipIds,
        } = await extension.afterPaymentLinked({
            prisma,
            accountId,
            userId,
            candidates: afterLinkCandidates,
        });
        for (const invoiceId of extensionRecalcIds) {
            markRecalc(invoiceId);
        }
        for (const invoiceId of extensionSkipIds ?? []) {
            invoiceIdsToRecalc.delete(invoiceId);
        }
    }

    await recalculateInvoicesFromLinkedPayments(prisma, invoiceIdsToRecalc);

    for (const row of prepared) {
        const key = `${row.customerId}::${row.effectiveReference}`;
        const winner = winnerResult.get(key);
        if (winner) {
            results[row.index] = { ...winner, index: row.index };
        }
    }

    return results;
}
