"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeGapInBaseCurrency = exports.recomputeGapInBaseCurrencyForCustomer = void 0;
exports.syncCustomerPolicyGapAmountsForCustomer = syncCustomerPolicyGapAmountsForCustomer;
exports.freezeCustomerPolicyGapOnDeactivation = freezeCustomerPolicyGapOnDeactivation;
exports.syncAllCustomerPolicyGapAmounts = syncAllCustomerPolicyGapAmounts;
const domain_db_1 = require("../domain-db");
const computePolicyGapAmounts_1 = require("./computePolicyGapAmounts");
const customerKpiSnapshot_1 = require("./customerKpiSnapshot");
const customerPolicyTypes_1 = require("./customerPolicyTypes");
const invoiceCapacityGapAmounts_1 = require("./invoiceCapacityGapAmounts");
const openReceivableByCustomerCurrency_1 = require("./openReceivableByCustomerCurrency");
const policyExclusion_1 = require("./policyExclusion");
const syncCreditInsuranceGapPipeline_1 = require("./syncCreditInsuranceGapPipeline");
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
};
function startOfTodayUtc() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function normalizeCurrency(code) {
    const value = code?.trim().toUpperCase();
    return value ? value : null;
}
/**
 * Aggregate invoice SUMs onto CustomerPolicy rows (D8).
 * `capacity_gap_amount` stores the KPI rollup (same as golden harness), not raw invoice sum.
 * `retained_capacity_gap` holds rollup state between sync runs.
 */
async function syncCustomerPolicyGapAmountsForCustomer(customerId, options) {
    const dbClient = options?.dbClient ?? domain_db_1.prisma;
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
    const activePolicyRow = policyRows.find((row) => row.is_active) ?? policyRows[0];
    const uncovered = (0, policyExclusion_1.isUncoveredExposureCustomer)({
        hasLinkedPolicy: (0, policyExclusion_1.hasActiveLinkedPolicy)(activePolicyRow.insurance_policy_id),
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
                    ...(0, computePolicyGapAmounts_1.nullGapPayload)(),
                    retained_capacity_gap: null,
                },
            });
        }
        if (!options?.skipInvoiceFlags && !options?.customerPolicyRowId) {
            const { syncInvoiceCapacityGapFlagsForCustomer } = await Promise.resolve().then(() => __importStar(require("./syncInvoiceCapacityGapFlags")));
            await syncInvoiceCapacityGapFlagsForCustomer(customerId, {
                dbClient,
            });
        }
        return { missingRate: false };
    }
    let missingRate = false;
    for (const policyRow of policyRows) {
        const policyFields = (0, customerPolicyTypes_1.mapCustomerPolicyRow)(policyRow);
        const policyId = policyRow.insurance_policy_id;
        if (policyId == null) {
            continue;
        }
        if (policyFields.outdated_dcl === true) {
            await dbClient.customerPolicy.update({
                where: { id: policyRow.id },
                data: {
                    ...(0, computePolicyGapAmounts_1.nullGapPayload)(),
                    retained_capacity_gap: null,
                },
            });
            continue;
        }
        const summed = await (0, invoiceCapacityGapAmounts_1.sumInvoiceCapacityGapForCustomerPolicy)(customer.account_id, customerId, policyId, dbClient);
        if (summed.missingRate) {
            missingRate = true;
        }
        const limitCurrency = normalizeCurrency(policyFields.approved_limit_currency) ??
            summed.limitCurrency;
        const accountCurrency = normalizeCurrency(customer.Account.currency);
        const sumInvoiceGaps = Math.max(0, summed.gapBase);
        let gapLimit = summed.gapLimit;
        if (limitCurrency &&
            accountCurrency &&
            limitCurrency === accountCurrency) {
            gapLimit = sumInvoiceGaps;
        }
        const openAr = options?.openAr ??
            (await (0, openReceivableByCustomerCurrency_1.fetchOpenReceivableForCustomer)(customer.account_id, customerId, policyId, dbClient));
        const approvedLimit = Number(policyFields.approved_limit ?? 0);
        const kpi = (0, customerKpiSnapshot_1.computePolicyCapacityGapKpi)({
            totalAr: openAr,
            sumInvoiceGaps,
            approvedLimit,
            retainedCapacityGap: policyRow.retained_capacity_gap,
        });
        const capacityGapKpi = kpi.capacityGapAmount;
        const gapLimitKpi = sumInvoiceGaps > 0
            ? gapLimit * (capacityGapKpi / sumInvoiceGaps)
            : 0;
        await dbClient.customerPolicy.update({
            where: { id: policyRow.id },
            data: {
                capacity_gap_amount: capacityGapKpi,
                capacity_gap_amount1: limitCurrency && accountCurrency && limitCurrency === accountCurrency
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
        const { syncInvoiceCapacityGapFlagsForCustomer } = await Promise.resolve().then(() => __importStar(require("./syncInvoiceCapacityGapFlags")));
        await syncInvoiceCapacityGapFlagsForCustomer(customerId, {
            dbClient,
        });
    }
    return { missingRate };
}
/** Freeze gap on the policy row being deactivated (call before is_active → false). */
async function freezeCustomerPolicyGapOnDeactivation(customerId, customerPolicyRowId, dbClient = domain_db_1.prisma) {
    await syncCustomerPolicyGapAmountsForCustomer(customerId, {
        customerPolicyRowId,
        skipInvoiceFlags: true,
        dbClient,
    });
}
async function syncAllCustomerPolicyGapAmounts() {
    const rateDate = startOfTodayUtc();
    const customers = await domain_db_1.prisma.customer.findMany({
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
        const { missingRate } = await (0, syncCreditInsuranceGapPipeline_1.syncCreditInsuranceGapPipelineForCustomer)(customer.id, { rateDate, dbClient: domain_db_1.prisma });
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
exports.recomputeGapInBaseCurrencyForCustomer = syncCustomerPolicyGapAmountsForCustomer;
/** @deprecated Use {@link syncAllCustomerPolicyGapAmounts}. */
exports.computeGapInBaseCurrency = syncAllCustomerPolicyGapAmounts;
