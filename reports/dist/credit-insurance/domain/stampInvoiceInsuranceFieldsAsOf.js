"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stampInvoiceInsuranceFieldsAsOf = stampInvoiceInsuranceFieldsAsOf;
const domain_db_1 = require("../domain-db");
const loadEffectiveInsuranceForCustomers_1 = require("./loadEffectiveInsuranceForCustomers");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
/**
 * Persist insurance-related invoice fields using {@link asOf} as the evaluation
 * calendar day (invoice import / chronological replay), not wall-clock today.
 *
 * Skips {@link syncInvoiceReportingBreach} so live cron rules do not overwrite
 * backfill stamps immediately afterward.
 */
async function stampInvoiceInsuranceFieldsAsOf(invoiceId, asOf, db = domain_db_1.prisma) {
    const inv = await db.invoice.findUnique({
        where: { id: invoiceId },
        select: {
            id: true,
            status: true,
            amount: true,
            invoice_date: true,
            due_date: true,
            payment_term: true,
            actual_reporting_date: true,
            customer_id: true,
            policy_id: true,
        },
    });
    if (!inv?.customer_id) {
        return;
    }
    const insuranceCtx = (await (0, loadEffectiveInsuranceForCustomers_1.loadEffectiveInsuranceForCustomers)([inv.customer_id])).get(inv.customer_id);
    if (!insuranceCtx) {
        return;
    }
    const policy = inv.policy_id != null
        ? await db.insurancePolicy.findFirst({
            where: { id: inv.policy_id },
            select: {
                end_date: true,
                score_validity_period_months: true,
                min_credit_score: true,
                dcl_customer_since_months: true,
            },
        })
        : null;
    const evaluationDate = (0, invoiceInsuranceFields_1.parseImportDateToLocalCalendarDate)(asOf) ??
        (0, invoiceInsuranceFields_1.parseImportDateToLocalCalendarDate)(inv.invoice_date) ??
        asOf;
    const insRow = (0, invoiceInsuranceFields_1.computeInvoiceInsuranceRowData)({
        status: inv.status,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        amount: inv.amount,
        actual_reporting_date: inv.actual_reporting_date,
        customer: insuranceCtx,
        explicitPaymentTerm: inv.payment_term !== null && inv.payment_term !== undefined
            ? inv.payment_term
            : undefined,
        today: evaluationDate,
    });
    const termsSnapshot = (0, invoiceInsuranceFields_1.computeCreatedTermsViolationSnapshot)({
        invoice_date: inv.invoice_date,
        customer: insuranceCtx,
        policy: policy?.end_date
            ? {
                end_date: policy.end_date,
                score_validity_period_months: policy.score_validity_period_months,
                min_credit_score: policy.min_credit_score,
                dcl_customer_since_months: policy.dcl_customer_since_months,
            }
            : null,
    });
    await db.invoice.update({
        where: { id: invoiceId },
        data: {
            payment_term: insRow.payment_term,
            target_reporting_date: insRow.target_reporting_date,
            target_mep_date: insRow.target_mep_date,
            reporting_breach: insRow.reporting_breach,
            ctv_payment_term: insRow.ctv_payment_term,
            ctv_customer_overdue_mep: termsSnapshot.ctv_customer_overdue_mep,
            ctv_customer_excluded_from_policy: termsSnapshot.ctv_customer_excluded_from_policy,
            ctv_outdated_dcl: termsSnapshot.ctv_outdated_dcl,
            ctv_invoice_after_policy_end: termsSnapshot.ctv_invoice_after_policy_end,
        },
    });
}
