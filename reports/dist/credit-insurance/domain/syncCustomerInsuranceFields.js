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
exports.syncCustomerInsuranceFields = syncCustomerInsuranceFields;
/**
 * Recomputes `Customer.oldest_invoice_overdue_date` and `Customer.overdue_block`
 * from live Invoice rows; policy-derived fields (MEP, DCL, limits) are written to
 * the active CustomerPolicy.
 *
 * Ported from the legacy `server/services/creditInsurance/syncCustomerInsuranceFields.ts`
 * (deleted in frontend commit 2223f5e). One legacy behaviour is intentionally dropped:
 * the original wrote an "overdue block applied/cleared" timeline Activity via
 * `ActivityService`, which has no Nest equivalent. Its only caller here is checkpoint
 * restore, where manufacturing an Activity row absent from the snapshot would corrupt
 * the restored baseline.
 */
const domain_db_1 = require("../domain-db");
const customerOutdatedDcl_1 = require("./customerOutdatedDcl");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
const resolveActiveCustomerPolicy_1 = require("./resolveActiveCustomerPolicy");
const syncCreditInsuranceGapPipeline_1 = require("./syncCreditInsuranceGapPipeline");
const syncZeroLimitAlertFlags_1 = require("./syncZeroLimitAlertFlags");
async function syncCustomerInsuranceFieldsCore(customerId, dbClient, validateZeroLimitDate, asOfDate) {
    const today = asOfDate ? new Date(asOfDate) : new Date();
    today.setHours(0, 0, 0, 0);
    const [overdueInvoices, customerRow, activePolicy] = await Promise.all([
        dbClient.invoice.findMany({
            where: {
                customer_id: customerId,
                status: "Overdue",
                OR: [{ amount: null }, { amount: { gte: 0 } }],
            },
            select: { due_date: true, amount: true },
        }),
        dbClient.customer.findUnique({
            where: { id: customerId },
            select: { overdue_block: true, account_id: true },
        }),
        (0, resolveActiveCustomerPolicy_1.getActiveCustomerPolicyRow)(customerId, dbClient),
    ]);
    let oldestDue = null;
    for (const invoice of overdueInvoices) {
        if (!(0, invoiceInsuranceFields_1.isEligibleForCustomerMepOverdue)(invoice.amount)) {
            continue;
        }
        if (!invoice.due_date) {
            continue;
        }
        const dueDate = new Date(invoice.due_date);
        if (!oldestDue || dueDate < oldestDue) {
            oldestDue = dueDate;
        }
    }
    const policyWithInsurance = activePolicy
        ? await dbClient.customerPolicy.findFirst({
            where: { id: activePolicy.id },
            select: {
                id: true,
                limit_type: true,
                credit_score: true,
                credit_score_input_date: true,
                active_customer_since: true,
                approved_limit: true,
                approved_limit_expiration_date: true,
                zero_limit_date: true,
                max_allowed_mep: true,
                approved_limit_currency: true,
                InsurancePolicy: {
                    select: {
                        min_credit_score: true,
                        score_validity_period_months: true,
                        dcl_customer_since_months: true,
                        currency: true,
                        max_dcl: true,
                    },
                },
            },
        })
        : null;
    const overdueBlock = (0, invoiceInsuranceFields_1.computeCustomerOverdueBlock)({
        oldestInvoiceOverdueDate: oldestDue,
        maxAllowedMepDays: policyWithInsurance?.max_allowed_mep ?? null,
        today,
    });
    const outdatedDcl = policyWithInsurance
        ? (0, customerOutdatedDcl_1.computeCustomerOutdatedDcl)({
            limitType: policyWithInsurance.limit_type,
            creditScore: policyWithInsurance.credit_score,
            minCreditScore: policyWithInsurance.InsurancePolicy?.min_credit_score ?? null,
            creditScoreInputDate: policyWithInsurance.credit_score_input_date,
            scoreValidityPeriodMonths: policyWithInsurance.InsurancePolicy
                ?.score_validity_period_months ?? null,
            activeCustomerSince: policyWithInsurance.active_customer_since,
            dclCustomerSinceMonths: policyWithInsurance.InsurancePolicy
                ?.dcl_customer_since_months ?? null,
            today,
        })
        : false;
    const approvedLimitPatch = policyWithInsurance
        ? (0, customerOutdatedDcl_1.resolveDclApprovedLimitAfterOutdatedRecompute)({
            limitType: policyWithInsurance.limit_type,
            outdatedDcl,
            creditScore: policyWithInsurance.credit_score,
            minCreditScore: policyWithInsurance.InsurancePolicy?.min_credit_score ?? null,
            userProvidedApprovedLimit: false,
            existingApprovedLimit: policyWithInsurance.approved_limit,
            patchedApprovedLimit: undefined,
            approvedLimitExpirationDate: policyWithInsurance.approved_limit_expiration_date ?? null,
            zeroLimitDate: policyWithInsurance.zero_limit_date ?? null,
            policyMaxDcl: policyWithInsurance.InsurancePolicy?.max_dcl ?? null,
            today,
        })
        : {};
    const previousBlock = customerRow?.overdue_block === true;
    await dbClient.customer.update({
        where: { id: customerId },
        data: {
            oldest_invoice_overdue_date: oldestDue,
            overdue_block: overdueBlock,
        },
    });
    if (policyWithInsurance) {
        await dbClient.customerPolicy.update({
            where: { id: policyWithInsurance.id },
            data: {
                outdated_dcl: outdatedDcl,
                approved_limit_currency: policyWithInsurance.InsurancePolicy?.currency ??
                    policyWithInsurance.approved_limit_currency ??
                    null,
                ...approvedLimitPatch,
            },
        });
    }
    await (0, syncZeroLimitAlertFlags_1.syncZeroLimitAlertFlagsForCustomer)({
        customerId,
        dbClient,
        validateZeroLimitDate,
    });
    return {
        accountId: customerRow?.account_id ?? null,
        previousBlock,
        overdueBlock,
    };
}
async function syncCustomerInsuranceFields(customerId, options = {}) {
    const { dbClient, runFollowUpEffects = dbClient == null, validateZeroLimitDate = false, invoiceIds, asOfDate, refreshTermsBreachFlags = false, } = options;
    if (dbClient && runFollowUpEffects) {
        throw new Error("syncCustomerInsuranceFields follow-up effects require a committed client");
    }
    let coreResult;
    if (dbClient) {
        coreResult = await syncCustomerInsuranceFieldsCore(customerId, dbClient, validateZeroLimitDate, asOfDate);
    }
    else {
        coreResult = await domain_db_1.prisma.$transaction(async (tx) => syncCustomerInsuranceFieldsCore(customerId, tx, validateZeroLimitDate, asOfDate));
    }
    if (!runFollowUpEffects) {
        return;
    }
    const overdueBlockChanged = coreResult.previousBlock !== coreResult.overdueBlock;
    if (refreshTermsBreachFlags || overdueBlockChanged) {
        const { refreshTermsBreachFlagsForCustomer } = await Promise.resolve().then(() => __importStar(require("./syncInvoiceReportingBreach")));
        await refreshTermsBreachFlagsForCustomer(customerId);
    }
    await (0, syncCreditInsuranceGapPipeline_1.syncCreditInsuranceGapPipelineForCustomer)(customerId, { invoiceIds });
}
