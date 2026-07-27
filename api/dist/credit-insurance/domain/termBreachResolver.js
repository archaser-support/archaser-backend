"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoiceHasTermsBreachForKpi = invoiceHasTermsBreachForKpi;
exports.sumFlagBasedTermsBreachOutstanding = sumFlagBasedTermsBreachOutstanding;
exports.resolveCustomerTermsBreachOutstanding = resolveCustomerTermsBreachOutstanding;
exports.resolvePortfolioTermsBreachContribution = resolvePortfolioTermsBreachContribution;
exports.resolveUncoveredExposureFromPolicyRows = resolveUncoveredExposureFromPolicyRows;
exports.uncoveredExposureFieldsFromPolicyRows = uncoveredExposureFieldsFromPolicyRows;
exports.aggregatePortfolioTermsBreachFromInvoices = aggregatePortfolioTermsBreachFromInvoices;
exports.fetchUncoveredCustomerIdsForAccount = fetchUncoveredCustomerIdsForAccount;
const domain_db_1 = require("../domain-db");
const policyExclusion_1 = require("./policyExclusion");
const customerPolicyTrendTermsBreachByReason_1 = require("./customerPolicyTrendTermsBreachByReason");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
function invoiceHasTermsBreachForKpi(invoice, asOf) {
    if (invoice.outstanding <= 0) {
        return false;
    }
    if ((0, customerPolicyTrendTermsBreachByReason_1.invoiceHasTermsBreachFlag)({
        reportingBreach: invoice.reportingBreach ?? false,
        ctvPaymentTerm: invoice.ctvPaymentTerm ?? false,
        ctvCustomerOverdueMep: invoice.ctvCustomerOverdueMep ?? false,
        ctvOutdatedDcl: invoice.ctvOutdatedDcl ?? false,
        ctvInvoiceAfterPolicyEnd: invoice.ctvInvoiceAfterPolicyEnd ?? false,
    })) {
        return true;
    }
    return (0, invoiceInsuranceFields_1.shouldSetReportingBreach)("Due", invoice.targetReportingDate ?? null, null, asOf);
}
function sumFlagBasedTermsBreachOutstanding(invoices, asOf, options) {
    let total = 0;
    for (const invoice of invoices) {
        if (!invoiceHasTermsBreachForKpi(invoice, asOf)) {
            continue;
        }
        const outstanding = Math.max(0, invoice.outstanding);
        if (options?.excludeCapacityGapInvoices && invoice.inCapacityGap) {
            total += Math.max(0, outstanding - Math.max(0, invoice.capacityGapAmount ?? 0));
            continue;
        }
        total += outstanding;
    }
    return total;
}
function resolveCustomerTermsBreachOutstanding(args) {
    if (args.uncovered) {
        return Math.max(0, args.totalOpenAr);
    }
    return sumFlagBasedTermsBreachOutstanding(args.invoices, args.asOf, {
        excludeCapacityGapInvoices: args.excludeCapacityGapInvoices,
    });
}
function resolvePortfolioTermsBreachContribution(args) {
    if (args.uncovered) {
        return 0;
    }
    return Math.max(0, args.flagBasedAmount);
}
function resolveUncoveredExposureFromPolicyRows(policyRows, policyId) {
    if (policyRows.length === 0) {
        return true;
    }
    const scopedRow = policyId != null
        ? policyRows.find((row) => row.insurance_policy_id === policyId) ??
            policyRows[0]
        : policyRows.find((row) => row.is_active) ?? policyRows[0];
    return (0, policyExclusion_1.isUncoveredExposureCustomer)({
        hasLinkedPolicy: (0, policyExclusion_1.hasActiveLinkedPolicy)(scopedRow?.insurance_policy_id),
        exclusionReason: scopedRow?.policy_exclusion_reason,
    });
}
function uncoveredExposureFieldsFromPolicyRows(policyRows, policyId) {
    if (policyRows.length === 0) {
        return { hasLinkedPolicy: false, exclusionReason: null };
    }
    const scopedRow = policyId != null
        ? policyRows.find((row) => row.insurance_policy_id === policyId) ??
            policyRows[0]
        : policyRows.find((row) => row.is_active) ?? policyRows[0];
    return {
        hasLinkedPolicy: (0, policyExclusion_1.hasActiveLinkedPolicy)(scopedRow?.insurance_policy_id),
        exclusionReason: scopedRow?.policy_exclusion_reason,
    };
}
function lineOutstandingFromInvoiceRow(row) {
    const debt = Number(row.outstanding_debt ?? 0);
    if (debt !== 0) {
        return Math.max(0, debt);
    }
    return Math.max(0, Number(row.customer_outstanding_debt ?? 0));
}
function aggregatePortfolioTermsBreachFromInvoices(invoices) {
    let totalAmount = 0;
    const countByReason = {
        reportingBreach: 0,
        paymentTerm: 0,
        customerOverdueMep: 0,
        outdatedDcl: 0,
        invoiceAfterPolicyEnd: 0,
    };
    for (const invoice of invoices) {
        totalAmount += lineOutstandingFromInvoiceRow(invoice);
        if (invoice.reporting_breach) {
            countByReason.reportingBreach += 1;
        }
        if (invoice.ctv_payment_term) {
            countByReason.paymentTerm += 1;
        }
        if (invoice.ctv_customer_overdue_mep) {
            countByReason.customerOverdueMep += 1;
        }
        if (invoice.ctv_outdated_dcl) {
            countByReason.outdatedDcl += 1;
        }
        if (invoice.ctv_invoice_after_policy_end) {
            countByReason.invoiceAfterPolicyEnd += 1;
        }
    }
    return {
        invoiceCount: invoices.length,
        totalAmount,
        countByReason,
    };
}
async function fetchUncoveredCustomerIdsForAccount(accountId) {
    const rows = await domain_db_1.prisma.customer.findMany({
        where: { account_id: accountId },
        select: {
            id: true,
            CustomerPolicy: {
                where: { is_active: true },
                select: {
                    insurance_policy_id: true,
                    policy_exclusion_reason: true,
                },
                take: 1,
            },
        },
    });
    const uncovered = new Set();
    for (const row of rows) {
        const policy = row.CustomerPolicy[0];
        if ((0, policyExclusion_1.isUncoveredExposureCustomer)({
            hasLinkedPolicy: (0, policyExclusion_1.hasActiveLinkedPolicy)(policy?.insurance_policy_id),
            exclusionReason: policy?.policy_exclusion_reason,
        })) {
            uncovered.add(row.id);
        }
    }
    return uncovered;
}
//# sourceMappingURL=termBreachResolver.js.map