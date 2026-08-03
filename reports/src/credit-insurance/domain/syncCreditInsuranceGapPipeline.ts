import { type DbClient, prisma as defaultPrisma } from "../domain-db";

import { syncCustomerPolicyGapAmountsForCustomer } from "./syncCustomerPolicyGapAmounts";
import { syncInvoiceCapacityGapAmountsForCustomer } from "./syncInvoiceCapacityGapAmounts";
import { syncInvoiceCapacityGapFlagsForCustomer } from "./syncInvoiceCapacityGapFlags";

/**
 * Single orchestration entry for credit-insurance capacity gap sync.
 * Order: invoice gaps → policy aggregate → in_capacity_gap flags.
 *
 * Does not re-stamp `limit_assessed_amount` — snapshots are sticky at invoice open.
 * Top-up added later does not retroactively change existing invoice gaps.
 */
export async function syncCreditInsuranceGapPipelineForCustomer(
    customerId: number,
    options?: {
        invoiceIds?: number[];
        dbClient?: DbClient;
        skipPolicyAggregate?: boolean;
        skipFlags?: boolean;
        rateDate?: Date;
    }
): Promise<{ missingRate: boolean }> {
    const { missingRate: invoiceMissing } =
        await syncInvoiceCapacityGapAmountsForCustomer(customerId, {
            invoiceIds: options?.invoiceIds,
            dbClient: options?.dbClient,
            rateDate: options?.rateDate,
        });

    let policyMissing = false;
    if (!options?.skipPolicyAggregate) {
        const policyResult = await syncCustomerPolicyGapAmountsForCustomer(
            customerId,
            {
                dbClient: options?.dbClient,
                rateDate: options?.rateDate,
                skipInvoiceFlags: true,
            }
        );
        policyMissing = policyResult.missingRate;
    }

    if (!options?.skipFlags) {
        await syncInvoiceCapacityGapFlagsForCustomer(customerId, {
            dbClient: options?.dbClient,
        });
    }

    return { missingRate: invoiceMissing || policyMissing };
}

/** Sync stored invoice + policy gap fields when account has credit insurance. */
export async function ensureCustomerCapacityGapStored(
    customerId: number,
    options?: {
        invoiceIds?: number[];
        dbClient?: DbClient;
        rateDate?: Date;
    }
): Promise<void> {
    const db = options?.dbClient ?? defaultPrisma;
    const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: { Account: { select: { has_credit_insurance: true } } },
    });
    if (!customer?.Account?.has_credit_insurance) {
        return;
    }
    await syncCreditInsuranceGapPipelineForCustomer(customerId, options);
}
