"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCreditInsuranceGapPipelineForCustomer = syncCreditInsuranceGapPipelineForCustomer;
exports.ensureCustomerCapacityGapStored = ensureCustomerCapacityGapStored;
const domain_db_1 = require("../domain-db");
const syncCustomerPolicyGapAmounts_1 = require("./syncCustomerPolicyGapAmounts");
const syncInvoiceCapacityGapAmounts_1 = require("./syncInvoiceCapacityGapAmounts");
const syncInvoiceCapacityGapFlags_1 = require("./syncInvoiceCapacityGapFlags");
async function syncCreditInsuranceGapPipelineForCustomer(customerId, options) {
    const { missingRate: invoiceMissing } = await (0, syncInvoiceCapacityGapAmounts_1.syncInvoiceCapacityGapAmountsForCustomer)(customerId, {
        invoiceIds: options?.invoiceIds,
        dbClient: options?.dbClient,
        rateDate: options?.rateDate,
    });
    let policyMissing = false;
    if (!options?.skipPolicyAggregate) {
        const policyResult = await (0, syncCustomerPolicyGapAmounts_1.syncCustomerPolicyGapAmountsForCustomer)(customerId, {
            dbClient: options?.dbClient,
            rateDate: options?.rateDate,
            skipInvoiceFlags: true,
        });
        policyMissing = policyResult.missingRate;
    }
    if (!options?.skipFlags) {
        await (0, syncInvoiceCapacityGapFlags_1.syncInvoiceCapacityGapFlagsForCustomer)(customerId, {
            dbClient: options?.dbClient,
        });
    }
    return { missingRate: invoiceMissing || policyMissing };
}
async function ensureCustomerCapacityGapStored(customerId, options) {
    const db = options?.dbClient ?? domain_db_1.prisma;
    const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: { Account: { select: { has_credit_insurance: true } } },
    });
    if (!customer?.Account?.has_credit_insurance) {
        return;
    }
    await syncCreditInsuranceGapPipelineForCustomer(customerId, options);
}
//# sourceMappingURL=syncCreditInsuranceGapPipeline.js.map