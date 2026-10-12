import { type DbClient, prisma as defaultPrisma } from "../domain-db";

import { resolveCreditPoolMemberIds } from "./parentCustomerCreditInheritance";
import { syncCustomerPolicyGapAmountsForCustomer } from "./syncCustomerPolicyGapAmounts";
import { syncInvoiceCapacityGapAmountsForCustomer } from "./syncInvoiceCapacityGapAmounts";
import { syncInvoiceCapacityGapFlagsForCustomer } from "./syncInvoiceCapacityGapFlags";

/**
 * Single orchestration entry for credit-insurance capacity gap sync.
 * Order: live invoice waterfall (assessed + gaps) → policy AR−effective card → in_capacity_gap flags.
 *
 * Parent/child pools: invoice waterfall and policy card run once for the whole
 * pool (shared effective limit vs group open AR); flags refresh on every member.
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
    const dbClient = options?.dbClient ?? defaultPrisma;

    const customer = await dbClient.customer.findUnique({
        where: { id: customerId },
        select: {
            account_id: true,
            Account: { select: { has_credit_insurance: true } },
        },
    });
    if (!customer?.Account?.has_credit_insurance) {
        return { missingRate: false };
    }

    const pool = await resolveCreditPoolMemberIds(
        customerId,
        customer.account_id,
        dbClient
    );
    const poolOpts = {
        poolMemberIds: pool.memberIds,
        poolRootCustomerId: pool.rootCustomerId,
    };

    const { missingRate: invoiceMissing } =
        await syncInvoiceCapacityGapAmountsForCustomer(customerId, {
            invoiceIds: options?.invoiceIds,
            dbClient,
            rateDate: options?.rateDate,
            ...poolOpts,
        });

    let policyMissing = false;
    if (!options?.skipPolicyAggregate) {
        const policyResult = await syncCustomerPolicyGapAmountsForCustomer(
            customerId,
            {
                dbClient,
                rateDate: options?.rateDate,
                skipInvoiceFlags: true,
                ...poolOpts,
            }
        );
        policyMissing = policyResult.missingRate;
    }

    if (!options?.skipFlags) {
        for (const memberId of pool.memberIds) {
            await syncInvoiceCapacityGapFlagsForCustomer(memberId, {
                dbClient,
            });
        }
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
