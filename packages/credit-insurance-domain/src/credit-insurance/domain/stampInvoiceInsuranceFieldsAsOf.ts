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

/** Rows per bulk UPDATE … FROM UNNEST (matches assessed-limit chunk size). */
const STAMP_WRITE_CHUNK = 500;

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
 * Persist computed as-of insurance stamps in one UPDATE per chunk.
 * `policy_id` is only set when {@link StampWriteRow.policyIdToSet} is non-null
 * (COALESCE keeps the existing policy otherwise).
 */
async function bulkWriteInsuranceAsOfStamps(
    db: DbClient,
    writes: StampWriteRow[]
): Promise<void> {
    if (writes.length === 0) {
        return;
    }
    for (let i = 0; i < writes.length; i += STAMP_WRITE_CHUNK) {
        const chunk = writes.slice(i, i + STAMP_WRITE_CHUNK);
        const ids = chunk.map((row) => row.id);
        const policyIds = chunk.map((row) => row.policyIdToSet);
        const paymentTerms = chunk.map((row) => row.payment_term);
        const targetReportingDates = chunk.map((row) =>
            row.target_reporting_date
                ? row.target_reporting_date.toISOString()
                : null
        );
        const targetMepDates = chunk.map((row) =>
            row.target_mep_date ? row.target_mep_date.toISOString() : null
        );
        const reportingBreaches = chunk.map((row) => row.reporting_breach);
        const ctvPaymentTerms = chunk.map((row) => row.ctv_payment_term);
        const ctvCustomerOverdueMeps = chunk.map(
            (row) => row.ctv_customer_overdue_mep
        );
        const ctvCustomerExcluded = chunk.map(
            (row) => row.ctv_customer_excluded_from_policy
        );
        const ctvOutdatedDcls = chunk.map((row) => row.ctv_outdated_dcl);
        const ctvAfterPolicyEnds = chunk.map(
            (row) => row.ctv_invoice_after_policy_end
        );

        await db.$executeRaw`
            UPDATE "Invoice" AS inv
            SET
                policy_id = COALESCE(data.policy_id, inv.policy_id),
                payment_term = data.payment_term,
                target_reporting_date =
                    data.target_reporting_date::timestamptz::date,
                target_mep_date = data.target_mep_date::timestamptz::date,
                reporting_breach = data.reporting_breach,
                ctv_payment_term = data.ctv_payment_term,
                ctv_customer_overdue_mep = data.ctv_customer_overdue_mep,
                ctv_customer_excluded_from_policy =
                    data.ctv_customer_excluded_from_policy,
                ctv_outdated_dcl = data.ctv_outdated_dcl,
                ctv_invoice_after_policy_end =
                    data.ctv_invoice_after_policy_end
            FROM (
                SELECT
                    UNNEST(${ids}::int[]) AS id,
                    UNNEST(${policyIds}::int[]) AS policy_id,
                    UNNEST(${paymentTerms}::int[]) AS payment_term,
                    UNNEST(${targetReportingDates}::text[])
                        AS target_reporting_date,
                    UNNEST(${targetMepDates}::text[]) AS target_mep_date,
                    UNNEST(${reportingBreaches}::boolean[]) AS reporting_breach,
                    UNNEST(${ctvPaymentTerms}::boolean[]) AS ctv_payment_term,
                    UNNEST(${ctvCustomerOverdueMeps}::boolean[])
                        AS ctv_customer_overdue_mep,
                    UNNEST(${ctvCustomerExcluded}::boolean[])
                        AS ctv_customer_excluded_from_policy,
                    UNNEST(${ctvOutdatedDcls}::boolean[]) AS ctv_outdated_dcl,
                    UNNEST(${ctvAfterPolicyEnds}::boolean[])
                        AS ctv_invoice_after_policy_end
            ) AS data
            WHERE inv.id = data.id
        `;
    }
}

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
            monthEnd: {
                mepCutoffDay: insuranceCtx.mep_cutoff_day,
                mepSubstituteExtraDays:
                    insuranceCtx.mep_substitute_extra_days,
            },
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

    await bulkWriteInsuranceAsOfStamps(db, writes);
}
