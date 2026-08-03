"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restampCustomerOpenInvoiceLimitAssessment = restampCustomerOpenInvoiceLimitAssessment;
exports.sumOpenArByCustomerPolicyInLimitCurrency = sumOpenArByCustomerPolicyInLimitCurrency;
const client_1 = require("@prisma/client");
const domain_db_1 = require("../domain-db");
const loadEffectiveInsuranceForCustomers_1 = require("./loadEffectiveInsuranceForCustomers");
const resolveEffectiveApprovedLimit_1 = require("./resolveEffectiveApprovedLimit");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
function customerPolicyScopeKey(customerId, policyId) {
    return `${customerId}:${policyId}`;
}
/**
 * Re-stamp `limit_assessed_amount` on open invoices in stable id order so
 * approved limit + top-up waterfall matches import / restamp scripts.
 */
async function restampCustomerOpenInvoiceLimitAssessment(customerId, options) {
    const dbClient = options?.dbClient ?? domain_db_1.prisma;
    const openInvoices = (await dbClient.invoice.findMany({
        where: {
            customer_id: customerId,
            policy_id: { not: null },
            status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] },
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
        orderBy: [{ policy_id: "asc" }, { id: "asc" }],
    }));
    if (openInvoices.length === 0) {
        return 0;
    }
    const insurance = (await (0, loadEffectiveInsuranceForCustomers_1.loadEffectiveInsuranceForCustomers)([customerId])).get(customerId);
    if (insurance?.approved_limit == null || insurance.policy_id == null) {
        return 0;
    }
    const approvedLimit = Number(insurance.approved_limit);
    if (!Number.isFinite(approvedLimit) || approvedLimit <= 0) {
        return 0;
    }
    const limitCurrency = insurance.approved_limit_currency ?? null;
    const runningOpenAr = new Map();
    let updated = 0;
    for (const inv of openInvoices) {
        if (inv.policy_id == null || inv.customer_id == null) {
            continue;
        }
        const scopeKey = customerPolicyScopeKey(inv.customer_id, inv.policy_id);
        const openBefore = runningOpenAr.get(scopeKey) ?? 0;
        const outstanding = Math.max(0, (0, invoiceInsuranceFields_1.invoiceOutstandingInLimitCurrency)({
            outstanding_debt: inv.outstanding_debt,
            customer_outstanding_debt: inv.customer_outstanding_debt,
            amount: inv.amount,
            customer_currency: inv.customer_currency,
            limit_assessed_currency: limitCurrency,
            accountCurrency: options?.accountCurrency ?? null,
        }));
        const resolved = await (0, resolveEffectiveApprovedLimit_1.resolveEffectiveApprovedLimit)(inv.customer_id, {
            baseApprovedLimit: insurance.approved_limit,
            baseApprovedLimitCurrency: insurance.approved_limit_currency,
            parentPrimaryPolicyId: inv.policy_id,
            asOfDate: inv.invoice_date ?? new Date(),
            dbClient: options?.dbClient,
        });
        const limitAssessedAmount = (0, invoiceInsuranceFields_1.computeLimitAssessedAmountForNewOpenInvoice)({
            approvedLimit,
            topUpTotal: resolved.topUpTotalInLimitCurrency,
            openArOnPolicyBeforeInvoice: openBefore,
            newInvoiceOutstanding: outstanding,
        });
        runningOpenAr.set(scopeKey, openBefore + outstanding);
        const prev = inv.limit_assessed_amount != null
            ? Number(inv.limit_assessed_amount)
            : null;
        if (prev === limitAssessedAmount) {
            continue;
        }
        if (options?.dryRun) {
            updated += 1;
            continue;
        }
        await dbClient.invoice.update({
            where: { id: inv.id },
            data: {
                limit_assessed_amount: new client_1.Prisma.Decimal(limitAssessedAmount),
                limit_assessed_at: new Date(),
                limit_assessed_currency: limitCurrency,
            },
        });
        updated += 1;
    }
    return updated;
}
/**
 * Sum open Due/Overdue AR per customer+policy in limit/policy currency.
 */
function sumOpenArByCustomerPolicyInLimitCurrency(rows, limitCurrencyByPolicyId, accountCurrency) {
    const map = new Map();
    for (const row of rows) {
        const limitCurrency = limitCurrencyByPolicyId.get(row.policy_id) ?? null;
        const key = customerPolicyScopeKey(row.customer_id, row.policy_id);
        const line = Math.max(0, (0, invoiceInsuranceFields_1.invoiceOutstandingInLimitCurrency)({
            outstanding_debt: row.outstanding_debt,
            customer_outstanding_debt: row.customer_outstanding_debt,
            amount: row.amount,
            customer_currency: row.customer_currency,
            limit_assessed_currency: limitCurrency,
            accountCurrency,
        }));
        map.set(key, (map.get(key) ?? 0) + line);
    }
    return map;
}
