import type { PrismaClient } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    sweepReportingBreachForOverdueInvoiceIds,
    syncCustomerInsuranceFields,
} from "@archaser/credit-insurance-domain";
import {
    calculateOutstandingAmountsForCustomersViaApi,
    recalculateCustomerAmountsViaApi,
} from "./customersDomain";

type OutstandingAmounts = {
    total_outstanding_amount: number;
    no_of_overdue_invoices: number;
    customer_currency1: string | null;
    customer_outstanding_amount1: number;
    customer_currency2: string | null;
    customer_outstanding_amount2: number;
};

async function getAllPastDueInvoices(
    prisma: PrismaClient,
    customerId?: number
) {
    const now = new Date();
    return prisma.invoice.findMany({
        where: {
            due_date: { lt: now },
            status: "Due",
            ...(typeof customerId === "number"
                ? { customer_id: customerId }
                : {}),
            OR: [
                { customer_outstanding_debt: { not: 0 } },
                { amount: { lt: 0 } },
            ],
        },
        select: {
            id: true,
            customer_id: true,
            account_id: true,
            due_date: true,
            amount: true,
            customer_outstanding_debt: true,
        },
    });
}

async function createOpenCollectionPeriods(
    prisma: PrismaClient,
    customerData: Array<{
        customerId: number;
        amounts: OutstandingAmounts;
        accountId: number;
        currency: string | null;
        categoryForNew: string | null;
        accountCategoryForNew: string | null;
        hasCollection: boolean | null;
        hasCreditInsurance: boolean | null;
        oldestOverdueDate: Date;
    }>
): Promise<{ created: number; skippedCreditOnly: number }> {
    let created = 0;
    let skippedCreditOnly = 0;

    bindCreditInsurancePrisma(prisma);

    for (const data of customerData) {
        const isCreditOnly =
            data.hasCollection === false && data.hasCreditInsurance === true;
        if (isCreditOnly) {
            skippedCreditOnly += 1;
            continue;
        }

        const existing = await prisma.customerCollectionPeriod.findFirst({
            where: {
                customer_id: data.customerId,
                period_end_date: null,
            },
            select: { id: true },
        });
        if (existing) {
            continue;
        }

        const categoryToUse =
            data.categoryForNew ||
            data.accountCategoryForNew ||
            "Automated";

        await prisma.customerCollectionPeriod.create({
            data: {
                customer_id: data.customerId,
                period_end_date: null,
                period_start_date: new Date(),
                no_of_overdue_invoices: data.amounts.no_of_overdue_invoices || 0,
                currency: data.currency,
                customer_currency1: data.amounts.customer_currency1 || "",
                customer_currency2: data.amounts.customer_currency2 || "",
                total_outstanding_amount:
                    data.amounts.total_outstanding_amount || 0,
                customer_outstanding_amount1:
                    data.amounts.customer_outstanding_amount1 || 0,
                customer_outstanding_amount2:
                    data.amounts.customer_outstanding_amount2 || 0,
                current_category: categoryToUse as never,
                last_automated_step: 0,
                create_next_activity: true,
            },
        });
        await syncCustomerInsuranceFields(data.customerId);
        created += 1;
    }

    return { created, skippedCreditOnly };
}

/**
 * Process overdue invoices: mark past-due Due invoices Overdue, recalc amounts,
 * activate inactive customers with debt, open collection periods when needed.
 */
export async function handleOverdueInvoices(
    prisma: PrismaClient,
    customerId?: number
): Promise<{
    success: boolean;
    message: string;
    summary: Record<string, unknown>;
    durationMs: number;
}> {
    const start = Date.now();
    const processStats = {
        totalInvoicesProcessed: 0,
        invoicesUpdated: 0,
        customersActivated: 0,
        dcpCreated: 0,
        dcpOldestOverdueDateRefreshed: 0,
        skippedCreditOnly: 0,
    };

    const pastDueInvoices = await getAllPastDueInvoices(prisma, customerId);
    processStats.totalInvoicesProcessed = pastDueInvoices.length;

    let affectedCustomerIds: number[] = [];

    if (pastDueInvoices.length > 0) {
        const invoiceIds = pastDueInvoices.map((i) => i.id);
        affectedCustomerIds = Array.from(
            new Set(
                pastDueInvoices
                    .map((i) => i.customer_id)
                    .filter((id): id is number => typeof id === "number")
            )
        );

        await prisma.invoice.updateMany({
            where: { id: { in: invoiceIds } },
            data: { status: "Overdue" },
        });
        processStats.invoicesUpdated = invoiceIds.length;

        bindCreditInsurancePrisma(prisma);
        await sweepReportingBreachForOverdueInvoiceIds(
            invoiceIds,
            prisma
        );
    }

    // Refresh oldest overdue / overdue_block for open periods
    {
        bindCreditInsurancePrisma(prisma);
        const openPeriods = await prisma.customerCollectionPeriod.findMany({
            where: {
                period_end_date: null,
                ...(typeof customerId === "number"
                    ? { customer_id: customerId }
                    : {}),
            },
            select: { customer_id: true },
        });
        const uniqueCustomerIds = Array.from(
            new Set(openPeriods.map((p) => p.customer_id))
        );
        for (const cid of uniqueCustomerIds) {
            await syncCustomerInsuranceFields(cid);
        }
        processStats.dcpOldestOverdueDateRefreshed = uniqueCustomerIds.length;
    }

    if (pastDueInvoices.length === 0 && affectedCustomerIds.length === 0) {
        return {
            success: true,
            message: "No work needed",
            summary: processStats,
            durationMs: Date.now() - start,
        };
    }

    if (affectedCustomerIds.length > 0) {
        try {
            await recalculateCustomerAmountsViaApi(affectedCustomerIds, prisma);
        } catch {
            // Continue even if recalc fails (legacy behavior)
        }
    }

    const outstandingMap = await calculateOutstandingAmountsForCustomersViaApi(
        affectedCustomerIds,
        prisma
    );

    const [customers, openPeriodRows] = await Promise.all([
        prisma.customer.findMany({
            where: { id: { in: affectedCustomerIds } },
            select: {
                id: true,
                collection_status: true,
                account_id: true,
                category_for_new_collection: true,
                Account: {
                    select: {
                        currency: true,
                        category_for_new_collection: true,
                        has_collection: true,
                        has_credit_insurance: true,
                    },
                },
            },
        }),
        prisma.customerCollectionPeriod.findMany({
            where: {
                customer_id: { in: affectedCustomerIds },
                period_end_date: null,
            },
            select: { customer_id: true },
        }),
    ]);

    const customerById = new Map(customers.map((c) => [c.id, c]));
    const inactiveCustomerIds = new Set(
        customers
            .filter((c) => c.collection_status === "Inactive")
            .map((c) => c.id)
    );
    const openPeriodCustomerIds = new Set(
        openPeriodRows.map((r) => r.customer_id)
    );

    const customersToActivate = affectedCustomerIds.filter((id) => {
        if (!inactiveCustomerIds.has(id)) {
            return false;
        }
        const amounts = outstandingMap.get(id);
        return amounts && (amounts.total_outstanding_amount ?? 0) > 0;
    });

    if (customersToActivate.length > 0) {
        await prisma.customer.updateMany({
            where: { id: { in: customersToActivate } },
            data: { collection_status: "Active" },
        });
        processStats.customersActivated = customersToActivate.length;
    }

    const customersNeedingCollectionPeriod = affectedCustomerIds.filter(
        (id) => {
            const amounts = outstandingMap.get(id);
            if (!amounts) return false;
            if ((amounts.no_of_overdue_invoices ?? 0) <= 0) return false;
            if ((amounts.total_outstanding_amount ?? 0) <= 0) return false;
            if (openPeriodCustomerIds.has(id)) return false;
            return true;
        }
    );

    if (customersNeedingCollectionPeriod.length > 0) {
        const withInvoices = await prisma.customer.findMany({
            where: { id: { in: customersNeedingCollectionPeriod } },
            include: {
                Invoice: {
                    where: {
                        due_date: { lte: new Date() },
                        status: "Overdue",
                    },
                    orderBy: { due_date: "asc" },
                    select: { due_date: true },
                },
            },
        });

        const payload = withInvoices.map((customer) => {
            const amounts =
                outstandingMap.get(customer.id) ??
                ({
                    total_outstanding_amount: 0,
                    no_of_overdue_invoices: 0,
                    customer_currency1: null,
                    customer_outstanding_amount1: 0,
                    customer_currency2: null,
                    customer_outstanding_amount2: 0,
                } satisfies OutstandingAmounts);
            const base = customerById.get(customer.id);
            const oldestOverdueDate =
                customer.Invoice.length > 0 && customer.Invoice[0]?.due_date
                    ? new Date(customer.Invoice[0].due_date)
                    : new Date();
            return {
                customerId: customer.id,
                amounts,
                accountId: base?.account_id ?? customer.account_id,
                currency: base?.Account?.currency ?? null,
                categoryForNew: base?.category_for_new_collection ?? null,
                accountCategoryForNew:
                    base?.Account?.category_for_new_collection ?? null,
                hasCollection: base?.Account?.has_collection ?? null,
                hasCreditInsurance:
                    base?.Account?.has_credit_insurance ?? null,
                oldestOverdueDate,
            };
        });

        const cp = await createOpenCollectionPeriods(prisma, payload);
        processStats.dcpCreated = cp.created;
        processStats.skippedCreditOnly = cp.skippedCreditOnly;
    }

    return {
        success: true,
        message: "Overdue invoices processed successfully",
        summary: processStats,
        durationMs: Date.now() - start,
    };
}
