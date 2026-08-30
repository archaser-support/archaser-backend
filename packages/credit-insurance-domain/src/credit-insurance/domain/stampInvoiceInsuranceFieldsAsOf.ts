import type { invoice_status } from "@prisma/client";

import type { DbClient } from "../domain-db";
import { prisma } from "../domain-db";

import { resolveCreatedOverdueMepForInvoice } from "./createdOverdueMepAtInvoiceDate";
import { resolveMepBreachStartDate } from "./resolveMepBreachStartDate";
import { loadEffectiveInsuranceForCustomers } from "./loadEffectiveInsuranceForCustomers";
import {
    computeCreatedTermsViolationSnapshot,
    computeInvoiceInsuranceRowData,
    parseImportDateToLocalCalendarDate,
} from "./invoiceInsuranceFields";

/**
 * Persist insurance-related invoice fields using {@link asOf} as the evaluation
 * calendar day (invoice import / chronological replay), not wall-clock today.
 *
 * Skips {@link syncInvoiceReportingBreach} so live cron rules do not overwrite
 * backfill stamps immediately afterward.
 */
export async function stampInvoiceInsuranceFieldsAsOf(
    invoiceId: number,
    asOf: Date,
    db: DbClient = prisma
): Promise<void> {
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
            account_id: true,
        },
    });

    if (!inv?.customer_id) {
        return;
    }

    const insuranceCtx = (
        await loadEffectiveInsuranceForCustomers([inv.customer_id])
    ).get(inv.customer_id);
    if (!insuranceCtx) {
        return;
    }

    // Importers never set policy_id, so fall back to the customer's effective
    // policy — without it the whole policy-scoped read path skips the invoice
    // and ctv_invoice_after_policy_end can never be true.
    const effectivePolicyId = inv.policy_id ?? insuranceCtx.policy_id ?? null;

    const policy =
        effectivePolicyId != null
            ? await db.insurancePolicy.findFirst({
                  where: { id: effectivePolicyId },
                  select: {
                      end_date: true,
                      score_validity_period_months: true,
                      min_credit_score: true,
                      dcl_customer_since_months: true,
                  },
              })
            : null;

    const evaluationDate =
        parseImportDateToLocalCalendarDate(asOf) ??
        parseImportDateToLocalCalendarDate(inv.invoice_date) ??
        asOf;

    const insRow = computeInvoiceInsuranceRowData({
        status: inv.status as invoice_status,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        amount: inv.amount,
        actual_reporting_date: inv.actual_reporting_date,
        customer: insuranceCtx,
        explicitPaymentTerm:
            inv.payment_term !== null && inv.payment_term !== undefined
                ? inv.payment_term
                : undefined,
        today: evaluationDate,
    });

    const mepBreachStartDate = await resolveMepBreachStartDate(
        inv.account_id,
        db
    );

    const overdueMepAtInvoiceDate =
        inv.account_id != null
            ? await resolveCreatedOverdueMepForInvoice({
                  accountId: inv.account_id,
                  customerId: inv.customer_id,
                  invoice: {
                      id: inv.id,
                      invoice_date: inv.invoice_date,
                      amount: inv.amount,
                  },
                  maxAllowedMep: insuranceCtx.max_allowed_mep,
                  mepBreachStartDate,
                  db,
              })
            : null;

    const termsSnapshot = computeCreatedTermsViolationSnapshot({
        invoice_date: inv.invoice_date,
        invoice_amount: inv.amount,
        customer_overdue_mep_at_invoice_date: overdueMepAtInvoiceDate,
        mep_breach_start_date: mepBreachStartDate,
        customer: insuranceCtx,
        policy: policy?.end_date
            ? {
                  end_date: policy.end_date,
                  score_validity_period_months:
                      policy.score_validity_period_months,
                  min_credit_score: policy.min_credit_score,
                  dcl_customer_since_months: policy.dcl_customer_since_months,
              }
            : null,
    });

    await db.invoice.update({
        where: { id: invoiceId },
        data: {
            ...(inv.policy_id == null && effectivePolicyId != null
                ? { policy_id: effectivePolicyId }
                : {}),
            payment_term: insRow.payment_term,
            target_reporting_date: insRow.target_reporting_date,
            target_mep_date: insRow.target_mep_date,
            reporting_breach: insRow.reporting_breach,
            ctv_payment_term: insRow.ctv_payment_term,
            ctv_customer_overdue_mep: termsSnapshot.ctv_customer_overdue_mep,
            ctv_customer_excluded_from_policy:
                termsSnapshot.ctv_customer_excluded_from_policy,
            ctv_outdated_dcl: termsSnapshot.ctv_outdated_dcl,
            ctv_invoice_after_policy_end:
                termsSnapshot.ctv_invoice_after_policy_end,
        },
    });
}
