import { prisma } from "../domain-db";

import {
    bulkUpdateInvoiceBooleanByValue,
    bulkUpdateInvoiceCtvSnapshots,
    bulkUpdateInvoiceTargetDates,
} from "./bulkInvoiceUpdates";
import { resolveCreatedOverdueMepByInvoiceId } from "./createdOverdueMepAtInvoiceDate";
import { loadEffectiveInsuranceForCustomers } from "./loadEffectiveInsuranceForCustomers";
import { resolveMepBreachStartDate } from "./resolveMepBreachStartDate";
import {
    resolveReportingBreachStartDate,
    resolveReportingBreachStartDatesForAccounts,
} from "./resolveReportingBreachStartDate";
import {
    computeCreatedTermsViolationSnapshot,
    computeInsuranceTargetDates,
    computePaymentTermBreach,
    shouldSetReportingBreach,
    startOfUtcDay,
} from "./invoiceInsuranceFields";

type DbClient = typeof prisma;

function datesEqualCalendarUtc(
    a: Date | null | undefined,
    b: Date | null | undefined
): boolean {
    if (a == null && b == null) {
        return true;
    }
    if (a == null || b == null) {
        return false;
    }
    return startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime();
}

/**
 * Sets Invoice.reporting_breach to true when Due/Overdue, target reporting date &lt; today,
 * and no actual_reporting_date. Sets to false only when actual_reporting_date is set.
 * Does not clear reporting_breach on Paid/Cancelled alone.
 */
export async function syncInvoiceReportingBreach(
    invoiceId: number,
    db: DbClient = prisma
): Promise<void> {
    const inv = await db.invoice.findUnique({
        where: { id: invoiceId },
        select: {
            id: true,
            account_id: true,
            invoice_date: true,
            status: true,
            amount: true,
            target_reporting_date: true,
            actual_reporting_date: true,
            reporting_breach: true,
        },
    });

    if (!inv) {
        return;
    }

    if (inv.actual_reporting_date) {
        if (inv.reporting_breach !== false) {
            await db.invoice.update({
                where: { id: invoiceId },
                data: { reporting_breach: false },
            });
        }
        return;
    }

    if (!inv.target_reporting_date) {
        return;
    }

    const today = new Date();
    const should = shouldSetReportingBreach(
        inv.status,
        inv.target_reporting_date,
        inv.actual_reporting_date,
        today,
        inv.amount,
        {
            invoiceDate: inv.invoice_date,
            reportingBreachStartDate: await resolveReportingBreachStartDate(
                inv.account_id,
                db
            ),
        }
    );

    if (!should || inv.reporting_breach) {
        return;
    }

    await db.invoice.update({
        where: { id: invoiceId },
        data: { reporting_breach: true },
    });
}

/**
 * When reporting was filed (actual date set), clear reporting_breach for IDs in this batch.
 * Matches {@link syncInvoiceReportingBreach} clearing rules.
 */
export async function clearReportingBreachWhenReportedForInvoiceIds(
    invoiceIds: number[],
    db: DbClient = prisma
): Promise<number> {
    if (invoiceIds.length === 0) {
        return 0;
    }
    const result = await db.invoice.updateMany({
        where: {
            id: { in: invoiceIds },
            actual_reporting_date: { not: null },
            reporting_breach: true,
        },
        data: { reporting_breach: false },
    });
    return result.count;
}

/**
 * Cron / batch: set reporting_breach to true using {@link shouldSetReportingBreach}
 * (Due/Overdue, target reporting date &lt; today, no actual_reporting_date). Only promotes false → true.
 */
export async function sweepReportingBreachForOverdueInvoiceIds(
    invoiceIds: number[],
    db: DbClient = prisma
): Promise<number> {
    if (invoiceIds.length === 0) {
        return 0;
    }
    const today = new Date();

    const invoices = await db.invoice.findMany({
        where: {
            id: { in: invoiceIds },
            status: { in: ["Due", "Overdue"] },
            actual_reporting_date: null,
            target_reporting_date: { not: null },
            reporting_breach: false,
            OR: [{ amount: null }, { amount: { gte: 0 } }],
        },
        select: {
            id: true,
            account_id: true,
            invoice_date: true,
            status: true,
            amount: true,
            target_reporting_date: true,
        },
    });

    // One connector read per distinct account in this batch, not per invoice.
    const startDateByAccountId =
        await resolveReportingBreachStartDatesForAccounts(
            invoices.map((inv) => inv.account_id),
            db
        );

    const toSetTrue: Array<{ id: number; value: boolean }> = [];
    for (const inv of invoices) {
        if (!inv.target_reporting_date) {
            continue;
        }
        const should = shouldSetReportingBreach(
            inv.status,
            inv.target_reporting_date,
            null,
            today,
            inv.amount,
            {
                invoiceDate: inv.invoice_date,
                reportingBreachStartDate:
                    inv.account_id != null
                        ? startDateByAccountId.get(inv.account_id) ?? null
                        : null,
            }
        );
        if (should) {
            toSetTrue.push({ id: inv.id, value: true });
        }
    }
    await bulkUpdateInvoiceBooleanByValue(db, "reporting_breach", toSetTrue);
    return toSetTrue.length;
}

/**
 * Recompute target_reporting_date and target_mep_date from invoice due_date and
 * Customer.reporting_days / max_allowed_mep (same as import / refreshInsuranceFields).
 *
 * Processes invoices in chunks; writes use a bulk UPDATE … FROM UNNEST so large
 * backfills do not issue one Prisma update per invoice. Optional onProgress
 * drives a sync tail step.
 */
export async function refreshInsuranceTargetDatesForInvoiceIds(
    invoiceIds: number[],
    db: DbClient = prisma,
    options?: {
        onProgress?: (progress: {
            processed: number;
            total: number;
        }) => void;
        /** Invoice ids loaded/updated per outer chunk (default 500). */
        chunkSize?: number;
        /** @deprecated Ignored — writes are bulk UNNEST, not per-row concurrency. */
        concurrency?: number;
    }
): Promise<number> {
    const uniqueIds = Array.from(
        new Set(invoiceIds.filter((id) => Number.isFinite(id) && id > 0))
    );
    if (uniqueIds.length === 0) {
        return 0;
    }

    const chunkSize = Math.max(1, options?.chunkSize ?? 500);
    const total = uniqueIds.length;
    let processed = 0;
    let updated = 0;

    options?.onProgress?.({ processed: 0, total });

    for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
        const idChunk = uniqueIds.slice(offset, offset + chunkSize);
        const rows = await db.invoice.findMany({
            where: { id: { in: idChunk } },
            select: {
                id: true,
                amount: true,
                invoice_date: true,
                due_date: true,
                target_reporting_date: true,
                target_mep_date: true,
                customer_id: true,
            },
        });
        const customerIds = Array.from(
            new Set(
                rows
                    .map((r) => r.customer_id)
                    .filter((id): id is number => id != null)
            )
        );
        const customerById = await loadEffectiveInsuranceForCustomers(
            customerIds
        );

        const pendingUpdates: Array<{
            id: number;
            target_reporting_date: Date | null;
            target_mep_date: Date | null;
        }> = [];

        for (const inv of rows) {
            if (inv.customer_id == null) {
                continue;
            }
            const c = customerById.get(inv.customer_id);
            const {
                target_reporting_date: nextReporting,
                target_mep_date: nextMep,
            } = computeInsuranceTargetDates({
                amount: inv.amount,
                due_date: inv.due_date,
                invoice_date: inv.invoice_date,
                customer: {
                    reporting_days: c?.reporting_days ?? null,
                    max_allowed_mep: c?.max_allowed_mep ?? null,
                    mep_cutoff_day: c?.mep_cutoff_day ?? null,
                    mep_substitute_extra_days:
                        c?.mep_substitute_extra_days ?? null,
                    reporting_cutoff_day:
                        c?.reporting_cutoff_day ?? null,
                    reporting_substitute_extra_days:
                        c?.reporting_substitute_extra_days ?? null,
                },
            });
            const reportingChanged = !datesEqualCalendarUtc(
                inv.target_reporting_date,
                nextReporting
            );
            const mepChanged = !datesEqualCalendarUtc(
                inv.target_mep_date,
                nextMep
            );
            if (!reportingChanged && !mepChanged) {
                continue;
            }
            pendingUpdates.push({
                id: inv.id,
                target_reporting_date: nextReporting,
                target_mep_date: nextMep,
            });
        }

        // Date-only refresh: update targets only — do not clear reporting_breach.
        await bulkUpdateInvoiceTargetDates(db, pendingUpdates);
        updated += pendingUpdates.length;

        processed = Math.min(offset + idChunk.length, total);
        options?.onProgress?.({ processed, total });
    }

    return updated;
}

/**
 * Recompute ctv_payment_term from invoice dates and Customer.max_payment_term (batch / cron).
 */
export async function refreshPaymentTermBreachForInvoiceIds(
    invoiceIds: number[],
    db: DbClient = prisma
): Promise<number> {
    if (invoiceIds.length === 0) {
        return 0;
    }
    const rows = await db.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: {
            id: true,
            invoice_date: true,
            due_date: true,
            ctv_payment_term: true,
            customer_id: true,
        },
    });
    const customerIds = Array.from(
        new Set(
            rows
                .map((r) => r.customer_id)
                .filter((id): id is number => id != null)
        )
    );
    if (customerIds.length === 0) {
        return 0;
    }
    const insuranceByCustomerId =
        await loadEffectiveInsuranceForCustomers(customerIds);

    const pending: Array<{ id: number; value: boolean }> = [];
    for (const inv of rows) {
        if (inv.customer_id == null) {
            continue;
        }
        const customerCtx = insuranceByCustomerId.get(inv.customer_id);
        const next = computePaymentTermBreach(
            inv.invoice_date,
            inv.due_date,
            customerCtx?.max_payment_term ?? null,
            {
                invoiceDate: inv.invoice_date,
                cutoffDayOfMonth:
                    customerCtx?.payment_term_cutoff_day ?? null,
                substituteDayOfMonth:
                    customerCtx?.payment_term_substitute_day ?? null,
            }
        );
        if (next !== inv.ctv_payment_term) {
            pending.push({ id: inv.id, value: next });
        }
    }
    await bulkUpdateInvoiceBooleanByValue(db, "ctv_payment_term", pending);
    return pending.length;
}

type CtvSnapshotRow = {
    id: number;
    invoice_date: Date;
    amount: number | null;
    account_id: number | null;
    customer_id: number | null;
    Customer: {
        CustomerPolicy: { max_allowed_mep: number | null }[];
    } | null;
};

/** Per-customer as-of MEP evaluation, so replays cannot leak today's block state. */
async function resolveCreatedOverdueMepForRows(
    rows: CtvSnapshotRow[],
    db: DbClient,
    mepBreachStartDateByAccountId: Map<number, Date | null>
): Promise<Map<number, boolean>> {
    const byCustomer = new Map<string, CtvSnapshotRow[]>();
    for (const row of rows) {
        if (row.account_id == null || row.customer_id == null) {
            continue;
        }
        const key = `${row.account_id}:${row.customer_id}`;
        const bucket = byCustomer.get(key) ?? [];
        bucket.push(row);
        byCustomer.set(key, bucket);
    }

    const resolved = new Map<number, boolean>();
    for (const bucket of byCustomer.values()) {
        const first = bucket[0]!;
        const flags = await resolveCreatedOverdueMepByInvoiceId({
            accountId: first.account_id!,
            customerId: first.customer_id!,
            invoices: bucket.map((row) => ({
                id: row.id,
                invoice_date: row.invoice_date,
                amount: row.amount,
            })),
            maxAllowedMep:
                first.Customer?.CustomerPolicy?.[0]?.max_allowed_mep ?? null,
            mepBreachStartDate:
                mepBreachStartDateByAccountId.get(first.account_id!) ?? null,
            db,
        });
        for (const [invoiceId, flag] of flags) {
            resolved.set(invoiceId, flag);
        }
    }
    return resolved;
}

/**
 * Recompute created-terms violation snapshot booleans from current Customer + InsurancePolicy rows.
 * Uses batched reads + bulk UNNEST writes (for cron/post-import sweep; avoids
 * N sequential full-service refreshes).
 */
export async function refreshCtvSnapshotsForInvoiceIds(
    invoiceIds: number[],
    db: DbClient = prisma
): Promise<number> {
    if (invoiceIds.length === 0) {
        return 0;
    }
    const rows = await db.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: {
            id: true,
            invoice_date: true,
            amount: true,
            account_id: true,
            customer_id: true,
            policy_id: true,
            ctv_customer_overdue_mep: true,
            ctv_customer_excluded_from_policy: true,
            ctv_outdated_dcl: true,
            ctv_invoice_after_policy_end: true,
            Customer: {
                select: {
                    overdue_block: true,
                    CustomerPolicy: {
                        where: { is_active: true },
                        take: 1,
                        select: {
                            policy_exclusion_reason: true,
                            credit_score_input_date: true,
                            insurance_policy_id: true,
                            limit_type: true,
                            credit_score: true,
                            active_customer_since: true,
                            max_allowed_mep: true,
                        },
                    },
                },
            },
        },
    });

    // One connector read per distinct account in this batch, not per invoice.
    const mepBreachStartDateByAccountId = new Map<number, Date | null>();
    for (const accountId of new Set(
        rows
            .map((row) => row.account_id)
            .filter((id): id is number => id != null)
    )) {
        mepBreachStartDateByAccountId.set(
            accountId,
            await resolveMepBreachStartDate(accountId, db)
        );
    }

    const overdueMepByInvoiceId = await resolveCreatedOverdueMepForRows(
        rows,
        db,
        mepBreachStartDateByAccountId
    );

    const policyIds = Array.from(
        new Set(
            rows
                .map((r) => r.Customer?.CustomerPolicy?.[0]?.insurance_policy_id)
                .filter((id): id is number => id != null)
        )
    );
    const policies =
        policyIds.length === 0
            ? []
            : await db.insurancePolicy.findMany({
                  where: { id: { in: policyIds } },
                  select: {
                      id: true,
                      end_date: true,
                      score_validity_period_months: true,
                      min_credit_score: true,
                      dcl_customer_since_months: true,
                  },
              });
    const policyById = new Map(policies.map((p) => [p.id, p]));

    const pending: Array<{
        id: number;
        policyIdToSet: number | null;
        ctv_customer_overdue_mep: boolean;
        ctv_customer_excluded_from_policy: boolean;
        ctv_outdated_dcl: boolean;
        ctv_invoice_after_policy_end: boolean;
    }> = [];

    for (const inv of rows) {
        if (!inv.Customer) {
            continue;
        }
        const activePolicy = inv.Customer.CustomerPolicy?.[0];
        const cid = activePolicy?.insurance_policy_id ?? null;
        const policyRow =
            cid != null ? policyById.get(cid) ?? null : null;
        const snap = computeCreatedTermsViolationSnapshot({
            invoice_date: inv.invoice_date,
            invoice_amount: inv.amount,
            // Prefer as-of map (false when absent) — never fall back to live
            // Customer.overdue_block (false positives on historical invoices).
            customer_overdue_mep_at_invoice_date:
                overdueMepByInvoiceId.get(inv.id) ?? false,
            mep_breach_start_date:
                inv.account_id != null
                    ? mepBreachStartDateByAccountId.get(inv.account_id) ?? null
                    : null,
            customer: {
                overdue_block: inv.Customer.overdue_block,
                policy_exclusion_reason: activePolicy?.policy_exclusion_reason,
                credit_score_input_date: activePolicy?.credit_score_input_date,
                policy_id: cid,
                limit_type: activePolicy?.limit_type ?? null,
                credit_score: activePolicy?.credit_score,
                active_customer_since: activePolicy?.active_customer_since,
            },
            policy: policyRow
                ? {
                      end_date: policyRow.end_date,
                      score_validity_period_months:
                          policyRow.score_validity_period_months,
                      min_credit_score: policyRow.min_credit_score,
                      dcl_customer_since_months:
                          policyRow.dcl_customer_since_months,
                  }
                : null,
        });

        // Importers never set policy_id; fill it from the active policy so the
        // policy-scoped read path stops skipping the invoice.
        const policyIdPatch = inv.policy_id == null && cid != null;

        const unchanged =
            !policyIdPatch &&
            snap.ctv_customer_overdue_mep === inv.ctv_customer_overdue_mep &&
            snap.ctv_customer_excluded_from_policy ===
                inv.ctv_customer_excluded_from_policy &&
            snap.ctv_outdated_dcl === inv.ctv_outdated_dcl &&
            snap.ctv_invoice_after_policy_end ===
                inv.ctv_invoice_after_policy_end;

        if (unchanged) {
            continue;
        }

        pending.push({
            id: inv.id,
            policyIdToSet: policyIdPatch ? cid : null,
            ctv_customer_overdue_mep: snap.ctv_customer_overdue_mep,
            ctv_customer_excluded_from_policy:
                snap.ctv_customer_excluded_from_policy,
            ctv_outdated_dcl: snap.ctv_outdated_dcl,
            ctv_invoice_after_policy_end: snap.ctv_invoice_after_policy_end,
        });
    }

    await bulkUpdateInvoiceCtvSnapshots(db, pending);

    return pending.length;
}

/**
 * Clear the "customer excluded from policy at creation" invoice flag
 * ({@link Invoice.ctv_customer_excluded_from_policy}) for every invoice of a customer
 * once the customer is included again (active policy `excluded_from_policy` is not true).
 * No-op while the customer is still excluded.
 */
export async function clearCustomerExcludedFromPolicyFlagWhenIncluded(
    customerId: number,
    db: DbClient = prisma
): Promise<number> {
    const activePolicy = await db.customerPolicy.findFirst({
        where: { customer_id: customerId, is_active: true },
        select: { excluded_from_policy: true },
    });

    // Keep the flag while the customer is still excluded from the policy.
    if (activePolicy?.excluded_from_policy === true) {
        return 0;
    }

    const result = await db.invoice.updateMany({
        where: {
            customer_id: customerId,
            ctv_customer_excluded_from_policy: true,
        },
        data: { ctv_customer_excluded_from_policy: false },
    });
    return result.count;
}

/** Open invoices loaded/refreshed per outer chunk in multi-customer restamp. */
const TERMS_BREACH_INVOICE_CHUNK = 1000;

/**
 * Recompute terms-breach invoice flags for many customers' open Due/Overdue
 * invoices in one pass (batched reads + bulk writes). Prefer this after link /
 * maturity instead of calling {@link refreshTermsBreachFlagsForCustomer} in a
 * loop.
 */
export async function refreshTermsBreachFlagsForCustomers(
    customerIds: number[],
    db: DbClient = prisma,
    options?: {
        onProgress?: (progress: { processed: number; total: number }) => void;
    }
): Promise<number> {
    const uniqueCustomerIds = Array.from(
        new Set(
            customerIds.filter((id) => Number.isFinite(id) && id > 0)
        )
    );
    if (uniqueCustomerIds.length === 0) {
        return 0;
    }

    let updated = 0;
    for (const customerId of uniqueCustomerIds) {
        updated += await clearCustomerExcludedFromPolicyFlagWhenIncluded(
            customerId,
            db
        );
    }

    const openInvoices = await db.invoice.findMany({
        where: {
            customer_id: { in: uniqueCustomerIds },
            status: { in: ["Due", "Overdue"] },
        },
        select: { id: true },
    });
    const invoiceIds = openInvoices.map((row) => row.id);
    if (invoiceIds.length === 0) {
        return updated;
    }

    const totalChunks = Math.ceil(
        invoiceIds.length / TERMS_BREACH_INVOICE_CHUNK
    );
    options?.onProgress?.({ processed: 0, total: totalChunks });
    let chunkIndex = 0;
    for (
        let offset = 0;
        offset < invoiceIds.length;
        offset += TERMS_BREACH_INVOICE_CHUNK
    ) {
        const chunk = invoiceIds.slice(
            offset,
            offset + TERMS_BREACH_INVOICE_CHUNK
        );
        updated += await refreshCtvSnapshotsForInvoiceIds(chunk, db);
        updated += await refreshPaymentTermBreachForInvoiceIds(chunk, db);
        updated += await refreshInsuranceTargetDatesForInvoiceIds(chunk, db);
        chunkIndex += 1;
        options?.onProgress?.({
            processed: chunkIndex,
            total: totalChunks,
        });
    }
    return updated;
}

/**
 * Recompute terms-breach invoice flags for a customer's open Due/Overdue invoices
 * after policy exclusion or limit-type changes. Also clears the "excluded from policy
 * at creation" flag across all of the customer's invoices when they are now included.
 */
export async function refreshTermsBreachFlagsForCustomer(
    customerId: number,
    db: DbClient = prisma
): Promise<number> {
    return refreshTermsBreachFlagsForCustomers([customerId], db);
}
