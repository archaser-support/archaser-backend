import { invoice_status, Prisma } from "@prisma/client";

import {
    allocateLiveCapacityGapWaterfall,
    compareInvoicesForLiveCapacityGapWaterfall,
    creditInsurancePrisma as prisma,
    invoiceOutstandingInLimitCurrency,
    loadEffectiveInsuranceForCustomers,
    resolveEffectiveApprovedLimit,
    type DbClient,
} from "@archaser/credit-insurance-domain";

type OpenInvoiceForRestamp = {
    id: number;
    policy_id: number | null;
    customer_id: number | null;
    invoice_date: Date | null;
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    customer_currency: string | null;
    amount: number | null;
    limit_assessed_amount: Prisma.Decimal | number | null;
};

/**
 * Re-stamp `limit_assessed_amount` on open invoices with the live capacity-gap
 * waterfall (oldest invoice_date first, current effective limit).
 * Prefer {@link syncCreditInsuranceGapPipelineForCustomer} in production paths.
 */
export async function restampCustomerOpenInvoiceLimitAssessment(
    customerId: number,
    options?: {
        dbClient?: DbClient;
        accountCurrency?: string | null;
        dryRun?: boolean;
    }
): Promise<number> {
    const dbClient = options?.dbClient ?? prisma;
    const openInvoices = (await dbClient.invoice.findMany({
        where: {
            customer_id: customerId,
            policy_id: { not: null },
            status: { in: [invoice_status.Due, invoice_status.Overdue] },
        },
        select: {
            id: true,
            policy_id: true,
            customer_id: true,
            invoice_date: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            customer_currency: true,
            amount: true,
            limit_assessed_amount: true,
        },
    })) as OpenInvoiceForRestamp[];

    if (openInvoices.length === 0) {
        return 0;
    }

    const insurance = (
        await loadEffectiveInsuranceForCustomers([customerId])
    ).get(customerId);
    if (insurance?.approved_limit == null || insurance.policy_id == null) {
        return 0;
    }

    const approvedLimit = Number(insurance.approved_limit);
    if (!Number.isFinite(approvedLimit) || approvedLimit <= 0) {
        return 0;
    }

    const limitCurrency = insurance.approved_limit_currency ?? null;
    const resolved = await resolveEffectiveApprovedLimit(customerId, {
        baseApprovedLimit: insurance.approved_limit,
        baseApprovedLimitCurrency: insurance.approved_limit_currency,
        parentPrimaryPolicyId: insurance.policy_id,
        asOfDate: new Date(),
        dbClient: options?.dbClient,
    });
    const effectiveLimit =
        resolved.effectiveApprovedLimit ?? approvedLimit;

    const sorted = openInvoices
        .slice()
        .sort(compareInvoicesForLiveCapacityGapWaterfall);

    const allocations = allocateLiveCapacityGapWaterfall({
        effectiveLimit,
        openInvoices: sorted.map((inv) => ({
            id: inv.id,
            outstandingInLimitCurrency: Math.max(
                0,
                invoiceOutstandingInLimitCurrency({
                    outstanding_debt: inv.outstanding_debt,
                    customer_outstanding_debt: inv.customer_outstanding_debt,
                    amount: inv.amount,
                    customer_currency: inv.customer_currency,
                    limit_assessed_currency: limitCurrency,
                    accountCurrency: options?.accountCurrency ?? null,
                })
            ),
        })),
    });

    let updated = 0;
    const assessedAt = new Date();
    for (const allocation of allocations) {
        const inv = sorted.find((row) => row.id === allocation.id);
        if (!inv) {
            continue;
        }
        const prev =
            inv.limit_assessed_amount != null
                ? Number(inv.limit_assessed_amount)
                : null;
        if (prev === allocation.limitAssessedAmount) {
            continue;
        }

        if (options?.dryRun) {
            updated += 1;
            continue;
        }

        await dbClient.invoice.update({
            where: { id: inv.id },
            data: {
                limit_assessed_amount: new Prisma.Decimal(
                    allocation.limitAssessedAmount
                ),
                limit_assessed_at: assessedAt,
                limit_assessed_currency: limitCurrency,
            },
        });
        updated += 1;
    }

    return updated;
}

function customerPolicyScopeKey(customerId: number, policyId: number): string {
    return `${customerId}:${policyId}`;
}

/**
 * Sum open Due/Overdue AR per customer+policy in limit/policy currency.
 */
export function sumOpenArByCustomerPolicyInLimitCurrency(
    rows: Array<{
        customer_id: number;
        policy_id: number;
        outstanding_debt: number | null;
        customer_outstanding_debt: number | null;
        customer_currency: string | null;
        amount: number | null;
    }>,
    limitCurrencyByPolicyId: Map<number, string | null | undefined>,
    accountCurrency: string | null | undefined
): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
        const limitCurrency = limitCurrencyByPolicyId.get(row.policy_id) ?? null;
        const key = customerPolicyScopeKey(row.customer_id, row.policy_id);
        const line = Math.max(
            0,
            invoiceOutstandingInLimitCurrency({
                outstanding_debt: row.outstanding_debt,
                customer_outstanding_debt: row.customer_outstanding_debt,
                amount: row.amount,
                customer_currency: row.customer_currency,
                limit_assessed_currency: limitCurrency,
                accountCurrency,
            })
        );
        map.set(key, (map.get(key) ?? 0) + line);
    }
    return map;
}
