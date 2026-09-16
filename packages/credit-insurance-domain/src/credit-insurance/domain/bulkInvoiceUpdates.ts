import type { DbClient } from "../domain-db";

/** Rows per UPDATE … FROM UNNEST / updateMany id list. */
export const BULK_INVOICE_UPDATE_CHUNK = 500;

export type InvoiceTargetDateWrite = {
    id: number;
    target_reporting_date: Date | null;
    target_mep_date: Date | null;
};

export type InvoiceCtvSnapshotWrite = {
    id: number;
    /** When non-null, set `policy_id`; otherwise leave existing policy. */
    policyIdToSet: number | null;
    ctv_customer_overdue_mep: boolean;
    ctv_customer_excluded_from_policy: boolean;
    ctv_outdated_dcl: boolean;
    ctv_invoice_after_policy_end: boolean;
};

/**
 * Bulk-set `target_reporting_date` / `target_mep_date` via one UPDATE per chunk.
 */
export async function bulkUpdateInvoiceTargetDates(
    db: DbClient,
    writes: InvoiceTargetDateWrite[]
): Promise<void> {
    if (writes.length === 0) {
        return;
    }
    for (let i = 0; i < writes.length; i += BULK_INVOICE_UPDATE_CHUNK) {
        const chunk = writes.slice(i, i + BULK_INVOICE_UPDATE_CHUNK);
        const ids = chunk.map((row) => row.id);
        const targetReportingDates = chunk.map((row) =>
            row.target_reporting_date
                ? row.target_reporting_date.toISOString()
                : null
        );
        const targetMepDates = chunk.map((row) =>
            row.target_mep_date ? row.target_mep_date.toISOString() : null
        );
        await db.$executeRaw`
            UPDATE "Invoice" AS inv
            SET
                target_reporting_date =
                    data.target_reporting_date::timestamptz::date,
                target_mep_date = data.target_mep_date::timestamptz::date
            FROM (
                SELECT
                    UNNEST(${ids}::int[]) AS id,
                    UNNEST(${targetReportingDates}::text[])
                        AS target_reporting_date,
                    UNNEST(${targetMepDates}::text[]) AS target_mep_date
            ) AS data
            WHERE inv.id = data.id
        `;
    }
}

/**
 * Bulk-set created-terms CTV snapshot columns (and optional policy_id).
 */
export async function bulkUpdateInvoiceCtvSnapshots(
    db: DbClient,
    writes: InvoiceCtvSnapshotWrite[]
): Promise<void> {
    if (writes.length === 0) {
        return;
    }
    for (let i = 0; i < writes.length; i += BULK_INVOICE_UPDATE_CHUNK) {
        const chunk = writes.slice(i, i + BULK_INVOICE_UPDATE_CHUNK);
        const ids = chunk.map((row) => row.id);
        const policyIds = chunk.map((row) => row.policyIdToSet);
        const overdueMeps = chunk.map((row) => row.ctv_customer_overdue_mep);
        const excluded = chunk.map(
            (row) => row.ctv_customer_excluded_from_policy
        );
        const outdatedDcls = chunk.map((row) => row.ctv_outdated_dcl);
        const afterPolicyEnds = chunk.map(
            (row) => row.ctv_invoice_after_policy_end
        );
        await db.$executeRaw`
            UPDATE "Invoice" AS inv
            SET
                policy_id = COALESCE(data.policy_id, inv.policy_id),
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
                    UNNEST(${overdueMeps}::boolean[])
                        AS ctv_customer_overdue_mep,
                    UNNEST(${excluded}::boolean[])
                        AS ctv_customer_excluded_from_policy,
                    UNNEST(${outdatedDcls}::boolean[]) AS ctv_outdated_dcl,
                    UNNEST(${afterPolicyEnds}::boolean[])
                        AS ctv_invoice_after_policy_end
            ) AS data
            WHERE inv.id = data.id
        `;
    }
}

/**
 * Set a boolean invoice column for many ids where the new value is the same
 * within each true/false group (chunked `updateMany`).
 */
export async function bulkUpdateInvoiceBooleanByValue(
    db: DbClient,
    column:
        | "ctv_payment_term"
        | "in_capacity_gap"
        | "reporting_breach",
    writes: Array<{ id: number; value: boolean }>
): Promise<void> {
    if (writes.length === 0) {
        return;
    }
    const trueIds: number[] = [];
    const falseIds: number[] = [];
    for (const row of writes) {
        if (row.value) {
            trueIds.push(row.id);
        } else {
            falseIds.push(row.id);
        }
    }
    for (const [ids, value] of [
        [trueIds, true],
        [falseIds, false],
    ] as const) {
        for (let i = 0; i < ids.length; i += BULK_INVOICE_UPDATE_CHUNK) {
            const chunk = ids.slice(i, i + BULK_INVOICE_UPDATE_CHUNK);
            await db.invoice.updateMany({
                where: { id: { in: chunk } },
                data: { [column]: value },
            });
        }
    }
}

export type InvoiceCapacityGapWrite = {
    id: number;
    limit_assessed_amount: number;
    limit_assessed_currency: string | null;
    capacity_gap_amount: number | null;
    capacity_gap_amount_limit: number;
    capacity_gap_amount_date: Date | null;
};

/**
 * Bulk-zero capacity gap columns for invoices outside the live waterfall set.
 */
export async function bulkZeroInvoiceCapacityGaps(
    db: DbClient,
    invoiceIds: number[]
): Promise<void> {
    if (invoiceIds.length === 0) {
        return;
    }
    for (let i = 0; i < invoiceIds.length; i += BULK_INVOICE_UPDATE_CHUNK) {
        const chunk = invoiceIds.slice(i, i + BULK_INVOICE_UPDATE_CHUNK);
        await db.invoice.updateMany({
            where: { id: { in: chunk } },
            data: {
                capacity_gap_amount: 0,
                capacity_gap_amount_limit: 0,
                capacity_gap_amount_date: null,
            },
        });
    }
}

/**
 * Bulk-write live waterfall assessed amounts + dual-currency capacity gaps.
 */
export async function bulkUpdateInvoiceCapacityGaps(
    db: DbClient,
    writes: InvoiceCapacityGapWrite[],
    assessedAt: Date
): Promise<void> {
    if (writes.length === 0) {
        return;
    }
    for (let i = 0; i < writes.length; i += BULK_INVOICE_UPDATE_CHUNK) {
        const chunk = writes.slice(i, i + BULK_INVOICE_UPDATE_CHUNK);
        const ids = chunk.map((row) => row.id);
        const assessedAmounts = chunk.map((row) => row.limit_assessed_amount);
        const assessedCurrencies = chunk.map(
            (row) => row.limit_assessed_currency
        );
        const gapBases = chunk.map((row) => row.capacity_gap_amount);
        const gapLimits = chunk.map((row) => row.capacity_gap_amount_limit);
        const gapDates = chunk.map((row) =>
            row.capacity_gap_amount_date
                ? row.capacity_gap_amount_date.toISOString()
                : null
        );
        await db.$executeRaw`
            UPDATE "Invoice" AS inv
            SET
                limit_assessed_amount = data.limit_assessed_amount,
                limit_assessed_currency = data.limit_assessed_currency,
                limit_assessed_at = ${assessedAt},
                capacity_gap_amount = data.capacity_gap_amount,
                capacity_gap_amount_limit = data.capacity_gap_amount_limit,
                capacity_gap_amount_date =
                    data.capacity_gap_amount_date::timestamptz::date
            FROM (
                SELECT
                    UNNEST(${ids}::int[]) AS id,
                    UNNEST(${assessedAmounts}::float8[])
                        AS limit_assessed_amount,
                    UNNEST(${assessedCurrencies}::text[])
                        AS limit_assessed_currency,
                    UNNEST(${gapBases}::float8[]) AS capacity_gap_amount,
                    UNNEST(${gapLimits}::float8[])
                        AS capacity_gap_amount_limit,
                    UNNEST(${gapDates}::text[]) AS capacity_gap_amount_date
            ) AS data
            WHERE inv.id = data.id
        `;
    }
}
