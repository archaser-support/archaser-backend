import { Prisma, invoice_status } from "@prisma/client";

import { type DbClient, prisma } from "../domain-db";

import { getActiveCustomerPolicyRow } from "./resolveActiveCustomerPolicy";

const CLOSED_INVOICE_STATUSES: invoice_status[] = [
    invoice_status.Paid,
    invoice_status.Void,
    invoice_status.Cancelled,
];

function hasZeroApprovedLimit(value: Prisma.Decimal | null | undefined): boolean {
    return value != null && value.equals(0);
}

export function isInvoiceEligibleForZeroLimitAlert(args: {
    status: invoice_status;
    invoiceDate: Date;
    zeroLimitDate: Date | null;
    approvedLimit: Prisma.Decimal | null | undefined;
}): boolean {
    if (!hasZeroApprovedLimit(args.approvedLimit) || !args.zeroLimitDate) {
        return false;
    }

    if (CLOSED_INVOICE_STATUSES.includes(args.status)) {
        return false;
    }

    return args.invoiceDate < args.zeroLimitDate;
}

export async function syncZeroLimitAlertFlagsForCustomer(args: {
    customerId: number;
    dbClient?: DbClient;
    validateZeroLimitDate?: boolean;
}): Promise<{ zeroLimitAlertExist: boolean }> {
    const dbClient = args.dbClient ?? prisma;
    const activePolicy = await getActiveCustomerPolicyRow(args.customerId, dbClient);
    const approvedLimit = activePolicy?.approved_limit ?? null;
    const zeroLimitDate = activePolicy?.zero_limit_date ?? null;
    const zeroLimitMissingDate =
        hasZeroApprovedLimit(approvedLimit) && zeroLimitDate == null;

    if (args.validateZeroLimitDate && zeroLimitMissingDate) {
        throw new Error(
            "Approve zero limit date is required when approved limit is 0"
        );
    }

    const invoices = await dbClient.invoice.findMany({
        where: { customer_id: args.customerId },
        select: {
            id: true,
            status: true,
            invoice_date: true,
            zero_limit_alert: true,
        },
    });

    const idsToEnable: number[] = [];
    const idsToDisable: number[] = [];

    for (const invoice of invoices) {
        const shouldAlert = isInvoiceEligibleForZeroLimitAlert({
            status: invoice.status,
            invoiceDate: invoice.invoice_date,
            zeroLimitDate,
            approvedLimit,
        });

        if (shouldAlert && !invoice.zero_limit_alert) {
            idsToEnable.push(invoice.id);
        } else if (!shouldAlert && invoice.zero_limit_alert) {
            idsToDisable.push(invoice.id);
        }
    }

    if (idsToEnable.length > 0) {
        await dbClient.invoice.updateMany({
            where: { id: { in: idsToEnable } },
            data: { zero_limit_alert: true },
        });
    }

    if (idsToDisable.length > 0) {
        await dbClient.invoice.updateMany({
            where: { id: { in: idsToDisable } },
            data: { zero_limit_alert: false },
        });
    }

    const zeroLimitAlertExist = invoices.some((invoice) =>
        idsToEnable.includes(invoice.id)
            ? true
            : idsToDisable.includes(invoice.id)
              ? false
              : invoice.zero_limit_alert
    );

    await dbClient.customer.update({
        where: { id: args.customerId },
        data: { zero_limit_alert_exist: zeroLimitAlertExist },
    });

    return { zeroLimitAlertExist };
}
