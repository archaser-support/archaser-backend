import type { invoice_status } from "@prisma/client";

import type { DbClient } from "../domain-db";
import { prisma } from "../domain-db";

import { resolveCreatedOverdueMepByInvoiceId } from "./createdOverdueMepAtInvoiceDate";
import { resolveMepBreachStartDate } from "./resolveMepBreachStartDate";
import { loadEffectiveInsuranceForCustomers } from "./loadEffectiveInsuranceForCustomers";
import {
    computeCreatedTermsViolationSnapshot,
    computeInvoiceInsuranceRowData,
    parseImportDateToLocalCalendarDate,
} from "./invoiceInsuranceFields";

const STAMP_WRITE_CHUNK = 200;

export type InvoiceInsuranceAsOfStamp = {
    invoiceId: number;
    asOf: Date;
};

type StampWriteRow = {
    id: number;
    policyIdToSet: number | null;
    payment_term: number | null;
    target_reporting_date: Date | null;
    target_mep_date: Date | null;
    reporting_breach: boolean;
    ctv_payment_term: boolean;
    ctv_customer_overdue_mep: boolean;
    ctv_customer_excluded_from_policy: boolean;
    ctv_outdated_dcl: boolean;
    ctv_invoice_after_policy_end: boolean;
};

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
    await stampInvoicesInsuranceFieldsAsOf([{ invoiceId, asOf }], db);
}

/**
 * Batch variant: load customer insurance + policies + MEP ledger once, compute
 * stamps in memory, then chunk-write updates.
 */
export async function stampInvoicesInsuranceFieldsAsOf(
    stamps: InvoiceInsuranceAsOfStamp[],
    db: DbClient = prisma
): Promise<void> {
    if (stamps.length === 0) {
        return;
    }

    const asOfByInvoiceId = new Map<number, Date>();
    for (const stamp of stamps) {
        asOfByInvoiceId.set(stamp.invoiceId, stamp.asOf);
    }
    const invoiceIds = Array.from(asOfByInvoiceId.keys());

    const invoices = await db.invoice.findMany({
        where: { id: { in: invoiceIds } },
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
    if (invoices.length === 0) {
        return;
    }

    const customerIds = Array.from(
        new Set(
            invoices
                .map((inv) => inv.customer_id)
                .filter((id): id is number => id != null)
        )
    );
    const insuranceByCustomer =
        await loadEffectiveInsuranceForCustomers(customerIds);

    const accountIds = Array.from(
        new Set(
            invoices
                .map((inv) => inv.account_id)
                .filter((id): id is number => id != null)
        )
    );
    const mepBreachByAccount = new Map<number, Date | null>();
    await Promise.all(
        accountIds.map(async (accountId) => {
            mepBreachByAccount.set(
                accountId,
                await resolveMepBreachStartDate(accountId, db)
            );
        })
    );

    const policyIds = new Set<number>();
    for (const inv of invoices) {
        if (!inv.customer_id) continue;
        const insuranceCtx = insuranceByCustomer.get(inv.customer_id);
        if (!insuranceCtx) continue;
        const effectivePolicyId = inv.policy_id ?? insuranceCtx.policy_id ?? null;
        if (effectivePolicyId != null) {
            policyIds.add(effectivePolicyId);
        }
    }

    const policies =
        policyIds.size > 0
            ? await db.insurancePolicy.findMany({
                  where: { id: { in: Array.from(policyIds) } },
                  select: {
                      id: true,
                      end_date: true,
                      score_validity_period_months: true,
                      min_credit_score: true,
                      dcl_customer_since_months: true,
                  },
              })
            : [];
    const policyById = new Map(policies.map((p) => [p.id, p]));

    // One open-AR ledger load per customer (not per invoice).
    const overdueMepByInvoiceId = new Map<number, boolean>();
    const invoicesByCustomer = new Map<number, typeof invoices>();
    for (const inv of invoices) {
        if (inv.customer_id == null) continue;
        const list = invoicesByCustomer.get(inv.customer_id) ?? [];
        list.push(inv);
        invoicesByCustomer.set(inv.customer_id, list);
    }
    for (const [customerId, customerInvoices] of invoicesByCustomer) {
        const insuranceCtx = insuranceByCustomer.get(customerId);
        if (!insuranceCtx) continue;
        const accountId = customerInvoices.find((i) => i.account_id != null)
            ?.account_id;
        if (accountId == null) continue;
        const byId = await resolveCreatedOverdueMepByInvoiceId({
            accountId,
            customerId,
            invoices: customerInvoices
                .filter((inv) => inv.invoice_date != null)
                .map((inv) => ({
                    id: inv.id,
                    invoice_date: inv.invoice_date!,
                    amount: inv.amount,
                })),
            maxAllowedMep: insuranceCtx.max_allowed_mep,
            mepBreachStartDate: mepBreachByAccount.get(accountId) ?? null,
            db,
        });
        for (const [invoiceId, flagged] of byId) {
            overdueMepByInvoiceId.set(invoiceId, flagged);
        }
    }

    const writes: StampWriteRow[] = [];
    for (const inv of invoices) {
        if (!inv.customer_id || !inv.invoice_date) continue;
        const insuranceCtx = insuranceByCustomer.get(inv.customer_id);
        if (!insuranceCtx) continue;

        const asOf = asOfByInvoiceId.get(inv.id) ?? inv.invoice_date;
        const effectivePolicyId = inv.policy_id ?? insuranceCtx.policy_id ?? null;
        const policy =
            effectivePolicyId != null
                ? policyById.get(effectivePolicyId) ?? null
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

        const mepBreachStartDate =
            inv.account_id != null
                ? (mepBreachByAccount.get(inv.account_id) ?? null)
                : null;

        const termsSnapshot = computeCreatedTermsViolationSnapshot({
            invoice_date: inv.invoice_date,
            invoice_amount: inv.amount,
            customer_overdue_mep_at_invoice_date:
                overdueMepByInvoiceId.get(inv.id) ?? false,
            mep_breach_start_date: mepBreachStartDate,
            customer: insuranceCtx,
            policy: policy?.end_date
                ? {
                      end_date: policy.end_date,
                      score_validity_period_months:
                          policy.score_validity_period_months,
                      min_credit_score: policy.min_credit_score,
                      dcl_customer_since_months:
                          policy.dcl_customer_since_months,
                  }
                : null,
        });

        writes.push({
            id: inv.id,
            policyIdToSet:
                inv.policy_id == null && effectivePolicyId != null
                    ? effectivePolicyId
                    : null,
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
        });
    }

    for (let i = 0; i < writes.length; i += STAMP_WRITE_CHUNK) {
        const chunk = writes.slice(i, i + STAMP_WRITE_CHUNK);
        await db.$transaction(
            chunk.map((row) =>
                db.invoice.update({
                    where: { id: row.id },
                    data: {
                        ...(row.policyIdToSet != null
                            ? { policy_id: row.policyIdToSet }
                            : {}),
                        payment_term: row.payment_term,
                        target_reporting_date: row.target_reporting_date,
                        target_mep_date: row.target_mep_date,
                        reporting_breach: row.reporting_breach,
                        ctv_payment_term: row.ctv_payment_term,
                        ctv_customer_overdue_mep: row.ctv_customer_overdue_mep,
                        ctv_customer_excluded_from_policy:
                            row.ctv_customer_excluded_from_policy,
                        ctv_outdated_dcl: row.ctv_outdated_dcl,
                        ctv_invoice_after_policy_end:
                            row.ctv_invoice_after_policy_end,
                    },
                })
            )
        );
    }
}
