/**
 * Shell-parent guards for credit (and collection) hierarchies: customers with
 * children must not have invoices/payments; a parent link target must be empty of AR.
 * Always-on (not gated on credit insurance).
 */
import type { DbClient } from "../domain-db";
import { prisma } from "../domain-db";

export const SHELL_PARENT_HAS_INVOICES_OR_PAYMENTS =
    "SHELL_PARENT_HAS_INVOICES_OR_PAYMENTS";
export const SHELL_CUSTOMER_HAS_CHILDREN_NO_AR =
    "SHELL_CUSTOMER_HAS_CHILDREN_NO_AR";

export class CreditPoolShellError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = "CreditPoolShellError";
        this.code = code;
    }
}

/**
 * Reject linking under a parent that already has invoices or payments.
 */
export async function assertParentIsShell(
    parentCustomerId: number,
    dbClient: DbClient = prisma
): Promise<void> {
    const [invoice, payment] = await Promise.all([
        dbClient.invoice.findFirst({
            where: { customer_id: parentCustomerId },
            select: { id: true },
        }),
        dbClient.invoicePayment.findFirst({
            where: { customer_id: parentCustomerId },
            select: { id: true },
        }),
    ]);
    if (invoice != null || payment != null) {
        throw new CreditPoolShellError(
            SHELL_PARENT_HAS_INVOICES_OR_PAYMENTS,
            "Parent customer must not have invoices or payments"
        );
    }
}

/**
 * Reject creating invoices/payments on a customer that already has children.
 */
export async function assertCustomerHasNoChildren(
    customerId: number,
    dbClient: DbClient = prisma
): Promise<void> {
    const child = await dbClient.customer.findFirst({
        where: { parent_customer_id: customerId },
        select: { id: true },
    });
    if (child != null) {
        throw new CreditPoolShellError(
            SHELL_CUSTOMER_HAS_CHILDREN_NO_AR,
            "Customers with children cannot have invoices or payments"
        );
    }
}

/**
 * Batch: which of these customer ids already have at least one child.
 */
export async function customerIdsWithChildren(
    customerIds: readonly number[],
    dbClient: DbClient = prisma
): Promise<Set<number>> {
    if (customerIds.length === 0) {
        return new Set();
    }
    const rows = await dbClient.customer.findMany({
        where: { parent_customer_id: { in: [...customerIds] } },
        select: { parent_customer_id: true },
        distinct: ["parent_customer_id"],
    });
    const out = new Set<number>();
    for (const row of rows) {
        if (row.parent_customer_id != null) {
            out.add(row.parent_customer_id);
        }
    }
    return out;
}
