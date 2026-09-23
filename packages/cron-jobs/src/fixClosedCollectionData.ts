import type { PrismaClient } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    syncCustomerInsuranceFields,
} from "@archaser/credit-insurance-domain";
import { resolveInvoicePaymentCloseDates } from "@archaser/billing-connector";

import type { CronFrozenAccountGuard } from "./accountFreeze/cronFrozenAccountGuard";
import { recalculateCustomerAmountsViaApi } from "./customersDomain";

/**
 * Safety net: for collection periods closed since last_run_at, mark zero-debt
 * Overdue invoices as Paid and refresh customer rollups / insurance fields.
 */
export async function fixClosedCollectionData(
    prisma: PrismaClient,
    lastRunAt: Date,
    freeze?: CronFrozenAccountGuard
): Promise<{
    success: boolean;
    message: string;
    summary: {
        totalCollectionPeriods: number;
        invoicesUpdated: number;
        customersRecalculated: number;
    };
    durationMs: number;
}> {
    const start = Date.now();

    const collectionPeriodsCount =
        await prisma.customerCollectionPeriod.count({
            where: {
                period_end_date: {
                    gte: lastRunAt,
                },
                ...(freeze && freeze.frozenAccountIds.size > 0
                    ? {
                          Customer: {
                              account_id: {
                                  notIn: [...freeze.frozenAccountIds],
                              },
                          },
                      }
                    : {}),
            },
        });

    if (collectionPeriodsCount === 0) {
        if (freeze && freeze.frozenAccountIds.size > 0) {
            const skippedRows = await prisma.invoice.findMany({
                where: {
                    customer_outstanding_debt: 0,
                    status: "Overdue",
                    account_id: { in: [...freeze.frozenAccountIds] },
                    CustomerCollectionPeriod: {
                        period_end_date: { gte: lastRunAt },
                    },
                },
                select: { account_id: true },
                distinct: ["account_id"],
            });
            freeze.reportSkips(
                skippedRows
                    .map((row) => row.account_id)
                    .filter((id): id is number => id != null)
            );
        }
        return {
            success: true,
            message: "No closed collection periods since last run",
            summary: {
                totalCollectionPeriods: 0,
                invoicesUpdated: 0,
                customersRecalculated: 0,
            },
            durationMs: Date.now() - start,
        };
    }

    const affectedInvoices = await prisma.invoice.findMany({
        where: {
            customer_outstanding_debt: 0,
            status: "Overdue",
            ...(freeze ? freeze.accountIdNotInFilter() : {}),
            CustomerCollectionPeriod: {
                period_end_date: {
                    gte: lastRunAt,
                },
            },
        },
        select: {
            id: true,
            customer_id: true,
            account_id: true,
        },
    });

    const affectedCustomerIds = Array.from(
        new Set(
            affectedInvoices
                .map((invoice) => invoice.customer_id)
                .filter(
                    (value): value is number =>
                        value !== null && value !== undefined
                )
        )
    );

    const modifiedAt = new Date();
    const invoiceIds = affectedInvoices.map((invoice) => invoice.id);
    let invoicesUpdated = 0;

    if (invoiceIds.length > 0) {
        const linkedPayments = await prisma.invoicePayment.findMany({
            where: { invoice_id: { in: invoiceIds } },
            select: { invoice_id: true, payment_date: true },
        });
        const paymentsByInvoiceId = new Map<number, Date[]>();
        for (const payment of linkedPayments) {
            if (payment.invoice_id == null) {
                continue;
            }
            const list = paymentsByInvoiceId.get(payment.invoice_id) ?? [];
            list.push(payment.payment_date);
            paymentsByInvoiceId.set(payment.invoice_id, list);
        }

        const ids: number[] = [];
        const lastPaymentDates: Array<Date | null> = [];
        const closeDates: Array<Date | null> = [];
        for (const invoice of affectedInvoices) {
            const dates = resolveInvoicePaymentCloseDates({
                status: "Paid",
                paymentDates: paymentsByInvoiceId.get(invoice.id) ?? [],
                modifiedAt,
            });
            ids.push(invoice.id);
            lastPaymentDates.push(dates.last_payment_date);
            closeDates.push(dates.close_date);
        }

        const CHUNK = 200;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const chunkIds = ids.slice(i, i + CHUNK);
            const chunkLast = lastPaymentDates.slice(i, i + CHUNK);
            const chunkClose = closeDates.slice(i, i + CHUNK);
            const result = await prisma.$executeRaw`
                UPDATE "Invoice" AS inv
                SET
                    status = 'Paid'::"invoice_status",
                    zero_limit_alert = false,
                    last_payment_date = data.last_payment_date,
                    close_date = data.close_date,
                    modified_at = ${modifiedAt}
                FROM (
                    SELECT
                        UNNEST(${chunkIds}::int[]) AS id,
                        UNNEST(${chunkLast}::date[]) AS last_payment_date,
                        UNNEST(${chunkClose}::date[]) AS close_date
                ) AS data
                WHERE inv.id = data.id
            `;
            invoicesUpdated += Number(result);
        }
    }

    bindCreditInsurancePrisma(prisma);
    for (const affectedCustomerId of affectedCustomerIds) {
        await syncCustomerInsuranceFields(affectedCustomerId);
    }

    await recalculateCustomerAmountsViaApi(affectedCustomerIds, prisma);

    if (freeze && freeze.frozenAccountIds.size > 0) {
        const skippedRows = await prisma.invoice.findMany({
            where: {
                customer_outstanding_debt: 0,
                status: "Overdue",
                account_id: { in: [...freeze.frozenAccountIds] },
                CustomerCollectionPeriod: {
                    period_end_date: { gte: lastRunAt },
                },
            },
            select: { account_id: true },
            distinct: ["account_id"],
        });
        freeze.reportSkips(
            skippedRows
                .map((row) => row.account_id)
                .filter((id): id is number => id != null)
        );
    }

    return {
        success: true,
        message: `Fix closed collection data: ${invoicesUpdated} invoices updated across ${affectedCustomerIds.length} customers`,
        summary: {
            totalCollectionPeriods: collectionPeriodsCount,
            invoicesUpdated,
            customersRecalculated: affectedCustomerIds.length,
        },
        durationMs: Date.now() - start,
    };
}
