import { Prisma } from "@prisma/client";

import { type DbClient, prisma } from "../domain-db";

export type InvoiceForCapacityGapFlag = {
    id: number;
    in_capacity_gap: boolean;
    capacity_gap_amount_limit: number | { toNumber(): number } | null;
};

/**
 * Sticky {@link Invoice.in_capacity_gap} from stored per-invoice gap limit amount.
 */
export function computeInvoiceCapacityGapFlagsFromStored(
    invoices: InvoiceForCapacityGapFlag[]
): Map<number, boolean> {
    const flags = new Map<number, boolean>();
    for (const inv of invoices) {
        const limitGap =
            inv.capacity_gap_amount_limit == null
                ? 0
                : typeof inv.capacity_gap_amount_limit === "number"
                  ? inv.capacity_gap_amount_limit
                  : inv.capacity_gap_amount_limit.toNumber();
        flags.set(inv.id, limitGap > 0);
    }
    return flags;
}

/**
 * Recompute {@link Invoice.in_capacity_gap} from stored invoice gap fields.
 * Does not invoke policy gap writer — use {@link syncCreditInsuranceGapPipelineForCustomer}.
 */
export async function syncInvoiceCapacityGapFlagsForCustomer(
    customerId: number,
    options?: {
        dbClient?: DbClient;
    }
): Promise<void> {
    const dbClient: DbClient = options?.dbClient ?? prisma;

    const customer = await dbClient.customer.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            account_id: true,
            Account: { select: { has_credit_insurance: true } },
        },
    });
    if (!customer?.Account?.has_credit_insurance) {
        return;
    }

    const openInvoices = (await dbClient.invoice.findMany({
        where: {
            customer_id: customerId,
            account_id: customer.account_id,
            status: { in: ["Due", "Overdue"] },
        },
        select: {
            id: true,
            in_capacity_gap: true,
            capacity_gap_amount_limit: true,
        },
    } as any)) as Array<{
        id: number;
        in_capacity_gap: boolean;
        capacity_gap_amount_limit: Prisma.Decimal | null;
    }>;

    const flags = computeInvoiceCapacityGapFlagsFromStored(
        openInvoices.map((inv) => ({
            id: inv.id,
            in_capacity_gap: inv.in_capacity_gap,
            capacity_gap_amount_limit:
                inv.capacity_gap_amount_limit == null
                    ? null
                    : inv.capacity_gap_amount_limit instanceof Prisma.Decimal
                      ? inv.capacity_gap_amount_limit.toNumber()
                      : Number(inv.capacity_gap_amount_limit),
        }))
    );

    const updates: { id: number; in_capacity_gap: boolean }[] = [];
    for (const inv of openInvoices) {
        const next = flags.get(inv.id) ?? false;
        if (inv.in_capacity_gap !== next) {
            updates.push({ id: inv.id, in_capacity_gap: next });
        }
    }

    if (updates.length === 0) {
        return;
    }

    await Promise.all(
        updates.map((u) =>
            dbClient.invoice.update({
                where: { id: u.id },
                data: { in_capacity_gap: u.in_capacity_gap },
            })
        )
    );
}

/**
 * Batch sync for all customers on an account with credit insurance enabled.
 */
export async function syncInvoiceCapacityGapFlagsForAccount(
    accountId: number
): Promise<{ customersProcessed: number }> {
    const customers = await prisma.customer.findMany({
        where: {
            account_id: accountId,
            collection_status: { in: ["Active", "Inactive"] },
            Account: { has_credit_insurance: true },
        },
        select: { id: true },
    });
    for (const c of customers) {
        const { syncCreditInsuranceGapPipelineForCustomer } = await import(
            "./syncCreditInsuranceGapPipeline"
        );
        await syncCreditInsuranceGapPipelineForCustomer(c.id);
    }
    return { customersProcessed: customers.length };
}
