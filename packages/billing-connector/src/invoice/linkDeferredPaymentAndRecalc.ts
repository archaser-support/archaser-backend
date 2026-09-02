import type { Invoice, InvoicePayment, Prisma, PrismaClient } from "@prisma/client";
import {
    INVOICE_PAID_TOLERANCE,
    isWithinPaidTolerance,
    resolveInvoicePaidTolerance,
} from "./invoicePaidTolerance";
import { resolveAccountBillingExtension } from "../extensions";
import type { ExtensionLinkedPayment } from "../extensions/types";

export type LinkDeferredPaymentAndRecalcResult = {
    invoicePayment: InvoicePayment;
    updatedInvoice: Invoice;
    alreadyLinked: boolean;
};

export {
    INVOICE_PAID_TOLERANCE,
    isWithinPaidTolerance,
    normalizeInvoicePaidTolerance,
    resolveInvoicePaidTolerance,
} from "./invoicePaidTolerance";

export type InvoicePaidRecalcOptions = {
    isForcePaidClose?: (payment: ExtensionLinkedPayment) => boolean;
    /** When set, skips a BillingConnector lookup inside the transaction. */
    paidTolerance?: number;
};

/** Default Prisma interactive tx timeout is 5s; replay recalc can exceed that under load. */
const LINK_PAYMENT_TRANSACTION_TIMEOUT_MS = 30_000;
const LINK_PAYMENT_TRANSACTION_MAX_WAIT_MS = 10_000;

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

const RECALC_PROGRESS_CHUNK = 200;
const BULK_PAYMENT_LINK_CHUNK = 500;

export type BulkDeferredPaymentLink = {
    paymentId: number;
    invoiceId: number;
    /** When set, link also realigns payment amounts to the invoice currency. */
    amount?: number;
    customer_amount?: number;
    customer_currency?: string;
};

type InvoicePaidRecalcRow = {
    id: number;
    total_paid: number;
    customer_total_paid: number;
    outstanding_debt: number;
    customer_outstanding_debt: number;
    status: Invoice["status"];
    clearAlerts: boolean;
};

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

/**
 * Read-only paid-close settings for an account. Safe to resolve before an
 * interactive transaction so tolerance/extension lookups do not burn tx time.
 */
export async function resolveInvoicePaidRecalcOptions(
    prisma: Pick<PrismaClient, "billingConnector">,
    accountId: number,
    overrides?: InvoicePaidRecalcOptions
): Promise<InvoicePaidRecalcOptions> {
    const [isForcePaidClose, paidTolerance] = await Promise.all([
        resolveForcePaidClose(prisma, accountId, overrides?.isForcePaidClose),
        overrides?.paidTolerance != null
            ? Promise.resolve(overrides.paidTolerance)
            : resolveInvoicePaidTolerance(prisma, accountId),
    ]);
    return {
        ...overrides,
        isForcePaidClose,
        paidTolerance,
    };
}

function buildInvoicePaidUpdate(
    invoice: InvoiceForPaidRecalc,
    linkedPayments: LinkedPaymentForRecalc[],
    options: InvoicePaidRecalcOptions | undefined,
    modifiedAt: Date,
    paidTolerance: number
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

    let totalPaid = 0;
    let totalCustomerPaid = 0;

    for (const payment of linkedPayments) {
        totalPaid += payment.amount ?? 0;
        totalCustomerPaid += payment.customer_amount ?? 0;
    }

    const newOutstanding = (invoice.net_amount ?? 0) - totalPaid;
    const newCustomerOutstanding =
        (invoice.customer_net_amount ?? 0) - totalCustomerPaid;
    const becomesPaid = isWithinPaidTolerance(
        newCustomerOutstanding,
        paidTolerance
    );

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

function toInvoicePaidRecalcRow(
    invoice: InvoiceForPaidRecalc,
    linkedPayments: LinkedPaymentForRecalc[],
    options: InvoicePaidRecalcOptions | undefined,
    paidTolerance: number
): InvoicePaidRecalcRow {
    const update = buildInvoicePaidUpdate(
        invoice,
        linkedPayments,
        options,
        new Date(),
        paidTolerance
    );
    const status =
        typeof update.status === "string"
            ? update.status
            : invoice.status;
    return {
        id: invoice.id,
        total_paid: update.total_paid as number,
        customer_total_paid: update.customer_total_paid as number,
        outstanding_debt: update.outstanding_debt as number,
        customer_outstanding_debt: update.customer_outstanding_debt as number,
        status,
        clearAlerts:
            update.zero_limit_alert === false &&
            update.reporting_breach === false,
    };
}

async function bulkWriteInvoicePaidRecalcRows(
    prisma: Pick<PrismaClient, "$executeRaw">,
    rows: InvoicePaidRecalcRow[],
    modifiedAt: Date
): Promise<void> {
    if (rows.length === 0) {
        return;
    }
    for (let i = 0; i < rows.length; i += RECALC_PROGRESS_CHUNK) {
        const chunk = rows.slice(i, i + RECALC_PROGRESS_CHUNK);
        const ids = chunk.map((row) => row.id);
        const totalPaid = chunk.map((row) => row.total_paid);
        const customerTotalPaid = chunk.map((row) => row.customer_total_paid);
        const outstandingDebt = chunk.map((row) => row.outstanding_debt);
        const customerOutstandingDebt = chunk.map(
            (row) => row.customer_outstanding_debt
        );
        const statuses = chunk.map((row) => row.status);
        const clearAlerts = chunk.map((row) => row.clearAlerts);
        await prisma.$executeRaw`
            UPDATE "Invoice" AS inv
            SET
                total_paid = data.total_paid,
                customer_total_paid = data.customer_total_paid,
                outstanding_debt = data.outstanding_debt,
                customer_outstanding_debt = data.customer_outstanding_debt,
                status = data.status::"invoice_status",
                modified_at = ${modifiedAt},
                zero_limit_alert = CASE
                    WHEN data.clear_alerts THEN false
                    ELSE inv.zero_limit_alert
                END,
                reporting_breach = CASE
                    WHEN data.clear_alerts THEN false
                    ELSE inv.reporting_breach
                END
            FROM (
                SELECT
                    UNNEST(${ids}::int[]) AS id,
                    UNNEST(${totalPaid}::float8[]) AS total_paid,
                    UNNEST(${customerTotalPaid}::float8[]) AS customer_total_paid,
                    UNNEST(${outstandingDebt}::float8[]) AS outstanding_debt,
                    UNNEST(${customerOutstandingDebt}::float8[]) AS customer_outstanding_debt,
                    UNNEST(${statuses}::text[]) AS status,
                    UNNEST(${clearAlerts}::boolean[]) AS clear_alerts
            ) AS data
            WHERE inv.id = data.id
        `;
    }
}

/**
 * Bulk-link deferred payments in chunks via UPDATE … FROM UNNEST. Simple rows
 * only set invoice_id; aligned rows also rewrite amount/currency columns.
 */
export async function bulkLinkDeferredPayments(
    prisma: PrismaClient,
    accountId: number,
    rows: BulkDeferredPaymentLink[],
    modifiedAt: Date,
    options?: {
        onChunkLinked?: (linkedInChunk: number) => void;
    }
): Promise<number> {
    if (rows.length === 0) {
        return 0;
    }

    let linked = 0;
    for (let i = 0; i < rows.length; i += BULK_PAYMENT_LINK_CHUNK) {
        const chunk = rows.slice(i, i + BULK_PAYMENT_LINK_CHUNK);
        const simple = chunk.filter(
            (row) => row.customer_currency === undefined
        );
        const aligned = chunk.filter(
            (row) => row.customer_currency !== undefined
        );
        let chunkLinked = 0;

        if (simple.length > 0) {
            const ids = simple.map((row) => row.paymentId);
            const invoiceIds = simple.map((row) => row.invoiceId);
            const result = await prisma.$executeRaw`
                UPDATE "InvoicePayment" AS p
                SET
                    invoice_id = data.invoice_id,
                    modified_at = ${modifiedAt}
                FROM (
                    SELECT
                        UNNEST(${ids}::int[]) AS id,
                        UNNEST(${invoiceIds}::int[]) AS invoice_id
                ) AS data
                WHERE p.id = data.id
                  AND p.account_id = ${accountId}
                  AND p.invoice_id IS NULL
            `;
            chunkLinked += Number(result);
        }

        if (aligned.length > 0) {
            const ids = aligned.map((row) => row.paymentId);
            const invoiceIds = aligned.map((row) => row.invoiceId);
            const amounts = aligned.map((row) => row.amount ?? 0);
            const customerAmounts = aligned.map(
                (row) => row.customer_amount ?? 0
            );
            const currencies = aligned.map(
                (row) => row.customer_currency ?? ""
            );
            const result = await prisma.$executeRaw`
                UPDATE "InvoicePayment" AS p
                SET
                    invoice_id = data.invoice_id,
                    amount = data.amount,
                    customer_amount = data.customer_amount,
                    customer_currency = data.customer_currency,
                    modified_at = ${modifiedAt}
                FROM (
                    SELECT
                        UNNEST(${ids}::int[]) AS id,
                        UNNEST(${invoiceIds}::int[]) AS invoice_id,
                        UNNEST(${amounts}::float8[]) AS amount,
                        UNNEST(${customerAmounts}::float8[]) AS customer_amount,
                        UNNEST(${currencies}::text[]) AS customer_currency
                ) AS data
                WHERE p.id = data.id
                  AND p.account_id = ${accountId}
                  AND p.invoice_id IS NULL
            `;
            chunkLinked += Number(result);
        }

        linked += chunkLinked;
        if (chunkLinked > 0) {
            options?.onChunkLinked?.(chunkLinked);
        }
    }

    return linked;
}

export async function recalculateInvoiceFromLinkedPayments(
    tx: Pick<PrismaClient, "invoice" | "invoicePayment" | "billingConnector">,
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
    const paidTolerance =
        options?.paidTolerance ??
        (await resolveInvoicePaidTolerance(tx, invoice.account_id));

    return tx.invoice.update({
        where: { id: invoiceId },
        data: buildInvoicePaidUpdate(
            invoice,
            linkedPayments,
            { ...options, isForcePaidClose },
            new Date(),
            paidTolerance
        ),
    });
}

/**
 * Recalculate many invoices: two batched reads, in-memory totals, bulk writes.
 */
export async function recalculateInvoicesFromLinkedPayments(
    prisma: Pick<
        PrismaClient,
        "invoice" | "invoicePayment" | "billingConnector" | "$transaction"
    >,
    targets: Map<number, InvoicePaidRecalcOptions>,
    options?: {
        onProgress?: (progress: { processed: number; total: number }) => void;
    }
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
    const paidToleranceByAccount = new Map<number, number>();
    for (const invoice of invoices) {
        if (!forcePaidByAccount.has(invoice.account_id)) {
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
        if (!paidToleranceByAccount.has(invoice.account_id)) {
            paidToleranceByAccount.set(
                invoice.account_id,
                await resolveInvoicePaidTolerance(prisma, invoice.account_id)
            );
        }
    }

    const modifiedAt = new Date();
    const recalcRows = invoices.map((invoice) =>
        toInvoicePaidRecalcRow(
            invoice,
            paymentsByInvoiceId.get(invoice.id) ?? [],
            {
                ...targets.get(invoice.id),
                isForcePaidClose: forcePaidByAccount.get(invoice.account_id),
            },
            paidToleranceByAccount.get(invoice.account_id) ??
                INVOICE_PAID_TOLERANCE
        )
    );

    if (!options?.onProgress) {
        await bulkWriteInvoicePaidRecalcRows(
            prisma as unknown as PrismaClient,
            recalcRows,
            modifiedAt
        );
        return;
    }

    options.onProgress({ processed: 0, total: recalcRows.length });
    for (
        let offset = 0;
        offset < recalcRows.length;
        offset += RECALC_PROGRESS_CHUNK
    ) {
        const chunk = recalcRows.slice(offset, offset + RECALC_PROGRESS_CHUNK);
        await bulkWriteInvoicePaidRecalcRows(
            prisma as unknown as PrismaClient,
            chunk,
            modifiedAt
        );
        options.onProgress({
            processed: Math.min(offset + chunk.length, recalcRows.length),
            total: recalcRows.length,
        });
    }
}

/**
 * Link many deferred payments (`invoice_id` null → target), then recalculate
 * each affected invoice once via {@link recalculateInvoicesFromLinkedPayments}.
 */
export async function linkDeferredPaymentsAndRecalcBatch(
    prisma: PrismaClient,
    links: Array<{ invoicePaymentId: number; invoiceId: number }>,
    recalcOptions?: InvoicePaidRecalcOptions
): Promise<{ paymentsLinked: number; invoicesRecalculated: number }> {
    if (links.length === 0) {
        return { paymentsLinked: 0, invoicesRecalculated: 0 };
    }

    const paymentIds = links.map((row) => row.invoicePaymentId);
    const payments = await prisma.invoicePayment.findMany({
        where: { id: { in: paymentIds } },
        select: { id: true, invoice_id: true, account_id: true },
    });
    const paymentById = new Map(payments.map((p) => [p.id, p]));

    const pending: Array<{ paymentId: number; invoiceId: number }> = [];
    for (const link of links) {
        const payment = paymentById.get(link.invoicePaymentId);
        if (!payment) continue;
        if (payment.invoice_id === link.invoiceId) continue;
        if (payment.invoice_id != null) continue;
        pending.push({
            paymentId: link.invoicePaymentId,
            invoiceId: link.invoiceId,
        });
    }

    if (pending.length === 0) {
        return { paymentsLinked: 0, invoicesRecalculated: 0 };
    }

    const modifiedAt = new Date();
    const accountId = payments[0]?.account_id;
    if (accountId == null) {
        return { paymentsLinked: 0, invoicesRecalculated: 0 };
    }

    const paymentsLinked = await bulkLinkDeferredPayments(
        prisma,
        accountId,
        pending.map((row) => ({
            paymentId: row.paymentId,
            invoiceId: row.invoiceId,
        })),
        modifiedAt
    );

    const targets = new Map<number, InvoicePaidRecalcOptions>();
    for (const row of pending) {
        targets.set(row.invoiceId, recalcOptions ?? {});
    }
    await recalculateInvoicesFromLinkedPayments(prisma, targets);

    return {
        paymentsLinked,
        invoicesRecalculated: targets.size,
    };
}

export async function linkDeferredPaymentAndRecalc(
    prisma: PrismaClient,
    params: {
        invoicePaymentId: number;
        invoiceId: number;
        forceRecalc?: boolean;
        recalcOptions?: InvoicePaidRecalcOptions;
    }
): Promise<LinkDeferredPaymentAndRecalcResult> {
    const { invoicePaymentId, invoiceId, forceRecalc = false } = params;

    let recalcOptions = params.recalcOptions;
    if (recalcOptions?.paidTolerance == null) {
        const paymentAccount = await prisma.invoicePayment.findUnique({
            where: { id: invoicePaymentId },
            select: { account_id: true },
        });
        if (!paymentAccount) {
            throw new Error(`InvoicePayment ${invoicePaymentId} not found`);
        }
        recalcOptions = await resolveInvoicePaidRecalcOptions(
            prisma,
            paymentAccount.account_id,
            recalcOptions
        );
    }

    return prisma.$transaction(
        async (tx) => {
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
                invoiceId,
                recalcOptions
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
            invoiceId,
            recalcOptions
        );

        return {
            invoicePayment: linkedPayment,
            updatedInvoice,
            alreadyLinked: false,
        };
        },
        {
            timeout: LINK_PAYMENT_TRANSACTION_TIMEOUT_MS,
            maxWait: LINK_PAYMENT_TRANSACTION_MAX_WAIT_MS,
        }
    );
}
