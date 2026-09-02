import type { PrismaClient } from "@prisma/client";
import {
    INVOICE_PAID_TOLERANCE,
    INVOICE_PAID_TOLERANCE_MAX,
    isWithinPaidTolerance,
} from "@archaser/billing-connector";
import {
    bindCreditInsurancePrisma,
    syncCustomerInsuranceFields,
} from "@archaser/credit-insurance-domain";

import type { CronFrozenAccountGuard } from "./accountFreeze/cronFrozenAccountGuard";
import { recalculateCustomerAmountsViaApi } from "./customersDomain";

const INVOICE_STATUS = {
    DUE: "Due",
    OVERDUE: "Overdue",
    PAID: "Paid",
} as const;

/**
 * Close Due/Overdue invoices with near-zero customer outstanding debt
 * (within ±account paid tolerance, else ±INVOICE_PAID_TOLERANCE), then
 * recalculate customer rollups and refresh credit-insurance fields. Large
 * negative outstanding (credit notes) is not treated as Paid.
 */
export async function closeZeroOutstandingDebtInvoices(
    prisma: PrismaClient,
    freeze?: CronFrozenAccountGuard
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

    const openInvoicesRaw = await prisma.invoice.findMany({
        where: {
            status: { in: [INVOICE_STATUS.DUE, INVOICE_STATUS.OVERDUE] },
            ...(freeze ? freeze.accountIdNotInFilter() : {}),
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
            account_id: true,
        },
    });

    for (const inv of openInvoicesRaw) {
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

    const connectors = await prisma.billingConnector.findMany({
        where: freeze?.frozenAccountIds.size
            ? { account_id: { notIn: [...freeze.frozenAccountIds] } }
            : undefined,
        select: { account_id: true, invoice_paid_tolerance: true },
    });
    const toleranceByAccount = new Map<number, number>();
    for (const connector of connectors) {
        const value = Number(connector.invoice_paid_tolerance);
        toleranceByAccount.set(
            connector.account_id,
            Number.isFinite(value) ? value : INVOICE_PAID_TOLERANCE
        );
    }

    const candidates = await prisma.invoice.findMany({
        where: {
            customer_outstanding_debt: {
                gte: -INVOICE_PAID_TOLERANCE_MAX,
                lte: INVOICE_PAID_TOLERANCE_MAX,
            },
            status: {
                in: [INVOICE_STATUS.DUE, INVOICE_STATUS.OVERDUE],
            },
            ...(freeze ? freeze.accountIdNotInFilter() : {}),
        },
        select: {
            id: true,
            customer_id: true,
            account_id: true,
            customer_outstanding_debt: true,
        },
    });

    const invoices = candidates.filter((invoice) =>
        isWithinPaidTolerance(
            invoice.customer_outstanding_debt ?? 0,
            toleranceByAccount.get(invoice.account_id) ?? INVOICE_PAID_TOLERANCE
        )
    );

    if (invoices.length === 0) {
        if (freeze && freeze.frozenAccountIds.size > 0) {
            const skippedRows = await prisma.invoice.findMany({
                where: {
                    status: {
                        in: [INVOICE_STATUS.DUE, INVOICE_STATUS.OVERDUE],
                    },
                    account_id: { in: [...freeze.frozenAccountIds] },
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

    bindCreditInsurancePrisma(prisma);
    for (const customerId of customerIds) {
        await syncCustomerInsuranceFields(customerId);
    }

    if (freeze && freeze.frozenAccountIds.size > 0) {
        const skippedRows = await prisma.invoice.findMany({
            where: {
                status: {
                    in: [INVOICE_STATUS.DUE, INVOICE_STATUS.OVERDUE],
                },
                account_id: { in: [...freeze.frozenAccountIds] },
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
        message: `Closed ${invoices.length} zero-debt invoices across ${customerIds.length} customers`,
        summary: {
            invoicesClosed: invoices.length,
            customersRecalculated: customerIds.length,
        },
        durationMs: Date.now() - start,
    };
}
