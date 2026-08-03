import { Prisma } from "@prisma/client";

import { type DbClient, prisma, prisma as defaultPrisma } from "../domain-db";

import { nullGapPayload } from "./computePolicyGapAmounts";
import { computePolicyCapacityGapKpi } from "./customerKpiSnapshot";
import {
    mapCustomerPolicyRow,
    type CustomerPolicyRowSelected,
} from "./customerPolicyTypes";
import { sumInvoiceCapacityGapForCustomerPolicy } from "./invoiceCapacityGapAmounts";
import { fetchOpenReceivableForCustomer } from "./openReceivableByCustomerCurrency";
import {
    hasActiveLinkedPolicy,
    isUncoveredExposureCustomer,
} from "./policyExclusion";
import { syncCreditInsuranceGapPipelineForCustomer } from "./syncCreditInsuranceGapPipeline";

const POLICY_GAP_SELECT = {
    id: true,
    insurance_policy_id: true,
    customer_number_policy: true,
    approved_limit: true,
    approved_limit_currency: true,
    approved_limit_expiration_date: true,
    limit_type: true,
    max_payment_term: true,
    max_allowed_mep: true,
    reporting_days: true,
    excluded_from_policy: true,
    policy_exclusion_reason: true,
    credit_score: true,
    credit_score_input_date: true,
    active_customer_since: true,
    outdated_dcl: true,
    retained_capacity_gap: true,
} satisfies Prisma.CustomerPolicySelect;

function startOfTodayUtc(): Date {
    const now = new Date();
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
}

function normalizeCurrency(code: string | null | undefined): string | null {
    const value = code?.trim().toUpperCase();
    return value ? value : null;
}

/**
 * Aggregate invoice SUMs onto CustomerPolicy rows (D8).
 * `capacity_gap_amount` stores the KPI rollup (same as golden harness), not raw invoice sum.
 * `retained_capacity_gap` holds rollup state between sync runs.
 */
export async function syncCustomerPolicyGapAmountsForCustomer(
    customerId: number,
    options?: {
        rateDate?: Date;
        openAr?: number;
        customerPolicyRowId?: number;
        skipInvoiceFlags?: boolean;
        dbClient?: DbClient;
    }
): Promise<{ missingRate: boolean }> {
    const dbClient = options?.dbClient ?? defaultPrisma;

    const customer = await dbClient.customer.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            account_id: true,
            Account: { select: { currency: true, has_credit_insurance: true } },
            CustomerPolicy: {
                where: options?.customerPolicyRowId
                    ? { id: options.customerPolicyRowId }
                    : { is_active: true },
                select: {
                    ...POLICY_GAP_SELECT,
                    is_active: true,
                },
            },
        },
    });

    if (!customer?.Account?.has_credit_insurance) {
        return { missingRate: false };
    }

    const policyRows = customer.CustomerPolicy;
    if (policyRows.length === 0) {
        return { missingRate: false };
    }

    const activePolicyRow =
        policyRows.find((row) => row.is_active) ?? policyRows[0];
    const uncovered = isUncoveredExposureCustomer({
        hasLinkedPolicy: hasActiveLinkedPolicy(
            activePolicyRow.insurance_policy_id
        ),
        exclusionReason: activePolicyRow.policy_exclusion_reason,
    });

    if (uncovered) {
        for (const policyRow of policyRows) {
            if (policyRow.insurance_policy_id == null) {
                continue;
            }
            await dbClient.customerPolicy.update({
                where: { id: policyRow.id },
                data: {
                    ...nullGapPayload(),
                    retained_capacity_gap: null,
                },
            });
        }
        if (!options?.skipInvoiceFlags && !options?.customerPolicyRowId) {
            const { syncInvoiceCapacityGapFlagsForCustomer } = await import(
                "./syncInvoiceCapacityGapFlags"
            );
            await syncInvoiceCapacityGapFlagsForCustomer(customerId, {
                dbClient,
            });
        }
        return { missingRate: false };
    }

    let missingRate = false;

    for (const policyRow of policyRows) {
        const policyFields = mapCustomerPolicyRow(
            policyRow as unknown as CustomerPolicyRowSelected
        );
        const policyId = policyRow.insurance_policy_id;
        if (policyId == null) {
            continue;
        }

        if (policyFields.outdated_dcl === true) {
            await dbClient.customerPolicy.update({
                where: { id: policyRow.id },
                data: {
                    ...nullGapPayload(),
                    retained_capacity_gap: null,
                },
            });
            continue;
        }

        const summed = await sumInvoiceCapacityGapForCustomerPolicy(
            customer.account_id,
            customerId,
            policyId,
            dbClient
        );

        if (summed.missingRate) {
            missingRate = true;
        }

        const limitCurrency =
            normalizeCurrency(policyFields.approved_limit_currency) ??
            summed.limitCurrency;

        const accountCurrency = normalizeCurrency(customer.Account.currency);
        const sumInvoiceGaps = Math.max(0, summed.gapBase);
        let gapLimit = summed.gapLimit;
        if (
            limitCurrency &&
            accountCurrency &&
            limitCurrency === accountCurrency
        ) {
            gapLimit = sumInvoiceGaps;
        }

        const openAr =
            options?.openAr ??
            (await fetchOpenReceivableForCustomer(
                customer.account_id,
                customerId,
                policyId,
                dbClient
            ));
        const approvedLimit = Number(policyFields.approved_limit ?? 0);
        const kpi = computePolicyCapacityGapKpi({
            totalAr: openAr,
            sumInvoiceGaps,
            approvedLimit,
            retainedCapacityGap: policyRow.retained_capacity_gap,
        });
        const capacityGapKpi = kpi.capacityGapAmount;
        const gapLimitKpi =
            sumInvoiceGaps > 0
                ? gapLimit * (capacityGapKpi / sumInvoiceGaps)
                : 0;

        await dbClient.customerPolicy.update({
            where: { id: policyRow.id },
            data: {
                capacity_gap_amount: capacityGapKpi,
                capacity_gap_amount1:
                    limitCurrency && accountCurrency && limitCurrency === accountCurrency
                        ? capacityGapKpi
                        : gapLimitKpi,
                capacity_gap_currency1: limitCurrency,
                capacity_gap_amount2: null,
                capacity_gap_currency2: null,
                retained_capacity_gap: kpi.retainedCapacityGap,
            },
        });
    }

    if (!options?.skipInvoiceFlags && !options?.customerPolicyRowId) {
        const { syncInvoiceCapacityGapFlagsForCustomer } = await import(
            "./syncInvoiceCapacityGapFlags"
        );
        await syncInvoiceCapacityGapFlagsForCustomer(customerId, {
            dbClient,
        });
    }

    return { missingRate };
}

/** Freeze gap on the policy row being deactivated (call before is_active → false). */
export async function freezeCustomerPolicyGapOnDeactivation(
    customerId: number,
    customerPolicyRowId: number,
    dbClient: DbClient = defaultPrisma
): Promise<void> {
    await syncCustomerPolicyGapAmountsForCustomer(customerId, {
        customerPolicyRowId,
        skipInvoiceFlags: true,
        dbClient,
    });
}

export async function syncAllCustomerPolicyGapAmounts(): Promise<{
    customersProcessed: number;
    customersUpdated: number;
    missingRates: number;
    rateDate: Date;
}> {
    const rateDate = startOfTodayUtc();

    const customers = await prisma.customer.findMany({
        where: {
            collection_status: "Active",
            Account: {
                has_credit_insurance: true,
            },
            CustomerPolicy: {
                some: {
                    is_active: true,
                    approved_limit: { not: null },
                },
            },
        },
        select: { id: true },
    });

    let customersUpdated = 0;
    let missingRates = 0;

    for (const customer of customers) {
        const { missingRate } = await syncCreditInsuranceGapPipelineForCustomer(
            customer.id,
            { rateDate, dbClient: prisma }
        );
        if (missingRate) {
            missingRates += 1;
        }
        customersUpdated += 1;
    }

    return {
        customersProcessed: customers.length,
        customersUpdated,
        missingRates,
        rateDate,
    };
}

/** @deprecated Use {@link syncCustomerPolicyGapAmountsForCustomer}. */
export const recomputeGapInBaseCurrencyForCustomer =
    syncCustomerPolicyGapAmountsForCustomer;

/** @deprecated Use {@link syncAllCustomerPolicyGapAmounts}. */
export const computeGapInBaseCurrency = syncAllCustomerPolicyGapAmounts;
