/**
 * Clone a source account into a new is_demo account.
 *
 * Copies collection + credit business data (customers, invoices, payments,
 * collection periods, disputes, policies, trends, credit dashboard snapshots,
 * reports, templates). Amounts stay the same. Company names and contact
 * fields are replaced. Billing pull keys stay as they are on the source:
 * customer number, CRN, invoice number, credit-for invoice number, payment
 * reference, business-unit external id, and the invoice billing code.
 * Billing connectors, import jobs, queues, real users, activities, and
 * attachment binaries are not copied. Business dates are shifted so the
 * newest invoice date is today. Financial dashboard metrics are live from
 * invoices / payments / collection periods / disputes (DashboardCache is
 * cleared so the UI recomputes).
 *
 * Usage:
 *   node ./scripts/run-with-env.cjs npx tsx scripts/database/clone-demo-account.ts \
 *     --source 10149 --password '…' [--name 'Demo Portfolio'] [--dry-run]
 *
 * Refresh an existing demo (--target): pause billing sync, re-copy live credit
 * fields (invoice AR/CTV/capacity-gap, payments, customer rollups, customer
 * policies, named policies, top-ups), replace collection periods + disputes +
 * policy trends from the source, neutralize ERP-only extras on the demo,
 * re-align dates so the newest invoice is today, restore faked ERP billing
 * ids, refill credit dashboard snapshots, and clear DashboardCache:
 *   node ./scripts/run-with-env.cjs npx tsx scripts/database/clone-demo-account.ts \
 *     --source 10149 --target 10151
 */
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const USER_COLUMNS = new Set([
    "created_by",
    "modified_by",
    "owner_id",
    "pending_created_by",
    "deleted_by",
    "saved_by",
]);

const AUDIT_DATES = new Set([
    "created_at",
    "modified_at",
    "deleted_at",
    "deactivated_at",
    "emailverified",
    "last_failed_login_at",
    "pending_created_at",
]);

const SECRET_ACCOUNT_COLUMNS = [
    "email_server_host",
    "email_server_user",
    "email_server_password",
    "email_from",
    "email_from_name",
    "sms_from_name",
    "sso_providers",
    "company_number",
    "beneficiary_name",
    "bank_name",
    "branch_number",
    "branch_name",
    "swift",
    "iban",
    "account_number",
    "bank_comments",
    "logo",
    "address_line1",
    "address_line2",
    "city",
    "postal_code",
] as const;

type Tx = Prisma.TransactionClient;
type ColumnInfo = {
    column_name: string;
    data_type: string;
    is_generated: string;
};

function argValue(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    if (index === -1) return undefined;
    return process.argv[index + 1];
}

function sqlIdent(name: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`Unsafe identifier: ${name}`);
    }
    return `"${name}"`;
}

function sqlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function requireInt(flag: string, fallback?: number): number {
    const raw = argValue(flag);
    if (raw === undefined) {
        if (fallback !== undefined) return fallback;
        throw new Error(`${flag} is required`);
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return value;
}

async function columns(tx: Tx, table: string): Promise<ColumnInfo[]> {
    return tx.$queryRaw<ColumnInfo[]>`
        SELECT column_name, data_type, is_generated
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${table}
          AND is_generated = 'NEVER'
        ORDER BY ordinal_position
    `;
}

async function insertCopy(
    tx: Tx,
    table: string,
    options: {
        from: string;
        where: string;
        overrides?: Record<string, string>;
        includeId?: boolean;
    }
): Promise<number> {
    const cols = await columns(tx, table);
    const overrides = options.overrides ?? {};
    const selected = cols.filter((column) => {
        if (column.column_name === "id" && !options.includeId) return false;
        return true;
    });
    const insertCols = selected
        .map((column) => sqlIdent(column.column_name))
        .join(", ");
    const selectCols = selected
        .map((column) => {
            const override = overrides[column.column_name];
            if (override) return `${override} AS ${sqlIdent(column.column_name)}`;
            if (USER_COLUMNS.has(column.column_name)) {
                return `(SELECT user_id FROM demo_ctx) AS ${sqlIdent(column.column_name)}`;
            }
            return `s.${sqlIdent(column.column_name)}`;
        })
        .join(", ");
    const sql = `
        INSERT INTO ${sqlIdent(table)} (${insertCols})
        SELECT ${selectCols}
        ${options.from}
        WHERE ${options.where}
    `;
    return tx.$executeRawUnsafe(sql);
}

async function syncSequence(tx: Tx, table: string): Promise<void> {
    const seqRows = await tx.$queryRawUnsafe<Array<{ seq: string | null }>>(`
        SELECT pg_get_serial_sequence('${sqlIdent(table)}', 'id') AS seq
    `);
    const seq = seqRows[0]?.seq;
    if (!seq) return;
    await tx.$executeRawUnsafe(`
        SELECT setval(
            ${sqlString(seq)},
            GREATEST(COALESCE((SELECT MAX(id) FROM ${sqlIdent(table)}), 1), 1),
            true
        )
    `);
}

async function allocateMap(
    tx: Tx,
    map: string,
    sourceSql: string,
    extraColumns = ""
): Promise<void> {
    await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE ${sqlIdent(map)} (
            old_id int PRIMARY KEY,
            new_id int NOT NULL UNIQUE
            ${extraColumns ? `, ${extraColumns}` : ""}
        ) ON COMMIT DROP
    `);
    await tx.$executeRawUnsafe(`
        INSERT INTO ${sqlIdent(map)}
        ${sourceSql}
    `);
}

async function relink(
    tx: Tx,
    table: string,
    column: string,
    map: string
): Promise<void> {
    await tx.$executeRawUnsafe(`
        UPDATE ${sqlIdent(table)} AS dest
        SET ${sqlIdent(column)} = parent.new_id
        FROM ${sqlIdent(map)} AS child
        JOIN ${sqlIdent(table)} AS src ON src.id = child.old_id
        JOIN ${sqlIdent(map)} AS parent ON parent.old_id = src.${sqlIdent(column)}
        WHERE dest.id = child.new_id
          AND src.${sqlIdent(column)} IS NOT NULL
    `);
}

async function shiftDates(
    tx: Tx,
    table: string,
    whereSql: string,
    deltaDays: number
): Promise<void> {
    if (deltaDays === 0) return;
    const cols = await columns(tx, table);
    for (const column of cols) {
        if (AUDIT_DATES.has(column.column_name.toLowerCase())) continue;
        const ident = sqlIdent(column.column_name);
        if (column.data_type === "date") {
            await tx.$executeRawUnsafe(`
                UPDATE ${sqlIdent(table)}
                SET ${ident} = ${ident} + ${deltaDays}
                WHERE ${whereSql} AND ${ident} IS NOT NULL
            `);
        } else if (column.data_type.includes("timestamp")) {
            await tx.$executeRawUnsafe(`
                UPDATE ${sqlIdent(table)}
                SET ${ident} = ${ident} + make_interval(days => ${deltaDays})
                WHERE ${whereSql} AND ${ident} IS NOT NULL
            `);
        }
    }
}

async function copyCreditDashboardSnapshots(
    tx: Tx,
    sourceId: number,
    targetId: number,
    dateDeltaDays: number
): Promise<number> {
    const sourceCount = await tx.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT COUNT(*)::int AS n
        FROM "CreditDashboardDailySnapshot"
        WHERE account_id = ${sourceId}
    `);
    await tx.$executeRawUnsafe(`
        DELETE FROM "CreditDashboardDailySnapshot" WHERE account_id = ${targetId}
    `);
    await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE snap_out ON COMMIT DROP AS
        SELECT
            ${targetId}::int AS account_id,
            CASE WHEN s.policy_id IS NULL THEN NULL ELSE mp.new_id::bigint END AS policy_id,
            CASE WHEN s.business_unit_id IS NULL THEN NULL ELSE mb.new_id END AS business_unit_id,
            (s.snapshot_date + ${dateDeltaDays})::date AS snapshot_date,
            s.health_index,
            s.total_receivables,
            s.compliant_exposure,
            s.at_risk_exposure,
            s.policy_risk_exposure,
            s.policy_risk_exposure_customer_count,
            s.gross_risk_exposure,
            s.overdue_block_customer_count,
            s.overdue_block_total_outstanding,
            s.capacity_gap_total_amount,
            s.capacity_gap_customer_over_limit_count,
            s.terms_breach_invoice_count,
            s.terms_breach_total_amount,
            s.terms_breach_count_by_reason,
            s.without_policy_customer_count,
            s.without_policy_total_amount,
            s.reporting_countdown_invoice_count,
            s.reporting_countdown_total_amount,
            s.reporting_countdown_window_days,
            s.limit_warnings_customer_count,
            s.limit_warnings_total_amount,
            s.limit_warnings_threshold_pct,
            s.limit_warnings_score_warn_days,
            s.account_currency,
            s.top_up_cover_total_amount,
            s.customers_with_active_top_up_count,
            s.top_up_expiring_customer_count,
            (s.policy_id IS NOT NULL AND mp.new_id IS NULL) AS unmapped_policy,
            (s.business_unit_id IS NOT NULL AND mb.new_id IS NULL) AS unmapped_bu
        FROM "CreditDashboardDailySnapshot" s
        LEFT JOIN map_policy mp ON mp.old_id = s.policy_id::int
        LEFT JOIN map_bu mb ON mb.old_id = s.business_unit_id
        WHERE s.account_id = ${sourceId}
    `);
    const problems = await tx.$queryRawUnsafe<
        Array<{ rows: number; unmapped: number; dupes: number }>
    >(`
        SELECT
            COUNT(*)::int AS rows,
            COUNT(*) FILTER (WHERE unmapped_policy OR unmapped_bu)::int AS unmapped,
            (
                SELECT COUNT(*)::int FROM (
                    SELECT 1
                    FROM snap_out
                    GROUP BY COALESCE(policy_id, 0), COALESCE(business_unit_id, 0), snapshot_date
                    HAVING COUNT(*) > 1
                ) d
            ) AS dupes
        FROM snap_out
    `);
    const check = problems[0];
    if ((check?.unmapped ?? 0) > 0) {
        throw new Error("Dashboard snapshot rows have a policy or business unit that was not cloned");
    }
    if ((check?.dupes ?? 0) > 0) {
        throw new Error("Dashboard snapshot copy would repeat the same account, policy, unit, and date");
    }
    if ((check?.rows ?? 0) !== (sourceCount[0]?.n ?? 0)) {
        throw new Error("Dashboard snapshot copy row count does not match the source");
    }
    return tx.$executeRawUnsafe(`
        INSERT INTO "CreditDashboardDailySnapshot" (
            account_id,
            policy_id,
            business_unit_id,
            snapshot_date,
            health_index,
            total_receivables,
            compliant_exposure,
            at_risk_exposure,
            policy_risk_exposure,
            policy_risk_exposure_customer_count,
            gross_risk_exposure,
            overdue_block_customer_count,
            overdue_block_total_outstanding,
            capacity_gap_total_amount,
            capacity_gap_customer_over_limit_count,
            terms_breach_invoice_count,
            terms_breach_total_amount,
            terms_breach_count_by_reason,
            without_policy_customer_count,
            without_policy_total_amount,
            reporting_countdown_invoice_count,
            reporting_countdown_total_amount,
            reporting_countdown_window_days,
            limit_warnings_customer_count,
            limit_warnings_total_amount,
            limit_warnings_threshold_pct,
            limit_warnings_score_warn_days,
            account_currency,
            top_up_cover_total_amount,
            customers_with_active_top_up_count,
            top_up_expiring_customer_count,
            created_at,
            modified_at
        )
        SELECT
            account_id,
            policy_id,
            business_unit_id,
            snapshot_date,
            health_index,
            total_receivables,
            compliant_exposure,
            at_risk_exposure,
            policy_risk_exposure,
            policy_risk_exposure_customer_count,
            gross_risk_exposure,
            overdue_block_customer_count,
            overdue_block_total_outstanding,
            capacity_gap_total_amount,
            capacity_gap_customer_over_limit_count,
            terms_breach_invoice_count,
            terms_breach_total_amount,
            terms_breach_count_by_reason,
            without_policy_customer_count,
            without_policy_total_amount,
            reporting_countdown_invoice_count,
            reporting_countdown_total_amount,
            reporting_countdown_window_days,
            limit_warnings_customer_count,
            limit_warnings_total_amount,
            limit_warnings_threshold_pct,
            limit_warnings_score_warn_days,
            account_currency,
            top_up_cover_total_amount,
            customers_with_active_top_up_count,
            top_up_expiring_customer_count,
            NOW(),
            NOW()
        FROM snap_out
        ON CONFLICT (
            account_id,
            (COALESCE(policy_id, (0)::bigint)),
            (COALESCE(business_unit_id, 0)),
            snapshot_date
        ) DO NOTHING
    `);
    const copiedRows = await tx.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT COUNT(*)::int AS n
        FROM "CreditDashboardDailySnapshot"
        WHERE account_id = ${targetId}
    `);
    if ((copiedRows[0]?.n ?? 0) !== (sourceCount[0]?.n ?? 0)) {
        throw new Error("Dashboard snapshot copy row count does not match the source");
    }
    return copiedRows[0]?.n ?? 0;
}

async function restoreErpIdentifiers(
    tx: Tx,
    sourceId: number,
    targetId: number
): Promise<void> {
    const pending = await tx.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT COUNT(*)::int AS n
        FROM "Customer"
        WHERE account_id = ${targetId}
          AND customer_number ~ '^C[0-9]{6}$'
    `);
    if ((pending[0]?.n ?? 0) > 0) {
        await tx.$executeRawUnsafe(`
            CREATE TEMP TABLE map_erp_customer ON COMMIT DROP AS
            SELECT s.id AS old_id,
                   d.id AS new_id,
                   s.customer_number,
                   s.crn,
                   s.fake_number
            FROM (
                SELECT id,
                       customer_number,
                       crn,
                       'C' || lpad(row_number() OVER (ORDER BY id)::text, 6, '0') AS fake_number
                FROM "Customer"
                WHERE account_id = ${sourceId}
            ) s
            JOIN "Customer" d
              ON d.account_id = ${targetId}
             AND d.customer_number = s.fake_number
        `);
        const mappedCustomers = await tx.$queryRawUnsafe<Array<{ n: number }>>(`
            SELECT COUNT(*)::int AS n FROM map_erp_customer
        `);
        if ((mappedCustomers[0]?.n ?? 0) !== (pending[0]?.n ?? 0)) {
            throw new Error("Could not match every demo customer back to the source customer number");
        }
        await tx.$executeRawUnsafe(`
            UPDATE "Customer"
            SET customer_number = 'tmp-' || id::text
            WHERE account_id = ${targetId}
        `);
        await tx.$executeRawUnsafe(`
            UPDATE "Customer" d
            SET customer_number = m.customer_number,
                crn = m.crn
            FROM map_erp_customer m
            WHERE d.id = m.new_id
        `);

        await tx.$executeRawUnsafe(`
            UPDATE "Company" d
            SET company_number = s.company_number
            FROM (
                SELECT company_number,
                       'Demo Company ' || lpad(row_number() OVER (ORDER BY id)::text, 4, '0') AS fake_name
                FROM "Company"
                WHERE id IN (
                    SELECT company_id FROM "Customer"
                    WHERE account_id = ${sourceId} AND company_id IS NOT NULL
                )
            ) s
            WHERE d.name = s.fake_name
              AND d.id IN (
                SELECT company_id FROM "Customer"
                WHERE account_id = ${targetId} AND company_id IS NOT NULL
              )
        `);

        await tx.$executeRawUnsafe(`
            CREATE TEMP TABLE map_erp_invoice ON COMMIT DROP AS
            SELECT d.id AS new_id,
                   s.invoice_number,
                   s.customer_number,
                   s.custom_code1,
                   s.credit_for_invoice_number,
                   s.ctv_customer_overdue_mep_cause_invoice_number
            FROM (
                SELECT invoice_number,
                       customer_number,
                       custom_code1,
                       credit_for_invoice_number,
                       ctv_customer_overdue_mep_cause_invoice_number,
                       'INV-' || lpad(row_number() OVER (ORDER BY id)::text, 6, '0') AS fake_number
                FROM "Invoice"
                WHERE account_id = ${sourceId}
            ) s
            JOIN "Invoice" d
              ON d.account_id = ${targetId}
             AND d.invoice_number = s.fake_number
        `);
        const invoiceCounts = await tx.$queryRawUnsafe<Array<{ src: number; mapped: number }>>(`
            SELECT
                (SELECT COUNT(*)::int FROM "Invoice" WHERE account_id = ${sourceId}) AS src,
                (SELECT COUNT(*)::int FROM map_erp_invoice) AS mapped
        `);
        if (invoiceCounts[0]?.src !== invoiceCounts[0]?.mapped) {
            throw new Error("Could not match every demo invoice back to the source invoice number");
        }
        await tx.$executeRawUnsafe(`
            UPDATE "Invoice"
            SET invoice_number = 'tmp-' || id::text
            WHERE account_id = ${targetId}
        `);
        await tx.$executeRawUnsafe(`
            UPDATE "Invoice" d
            SET invoice_number = m.invoice_number,
                customer_number = m.customer_number,
                custom_code1 = m.custom_code1,
                credit_for_invoice_number = m.credit_for_invoice_number,
                ctv_customer_overdue_mep_cause_invoice_number = m.ctv_customer_overdue_mep_cause_invoice_number
            FROM map_erp_invoice m
            WHERE d.id = m.new_id
        `);

        await tx.$executeRawUnsafe(`
            CREATE TEMP TABLE map_erp_payment ON COMMIT DROP AS
            SELECT d.id AS new_id,
                   s.reference,
                   s.invoice_number
            FROM (
                SELECT reference,
                       invoice_number,
                       'PAY-' || lpad(row_number() OVER (ORDER BY id)::text, 8, '0') AS fake_reference
                FROM "InvoicePayment"
                WHERE account_id = ${sourceId}
            ) s
            JOIN "InvoicePayment" d
              ON d.account_id = ${targetId}
             AND d.reference = s.fake_reference
        `);
        const paymentCounts = await tx.$queryRawUnsafe<Array<{ src: number; mapped: number }>>(`
            SELECT
                (SELECT COUNT(*)::int FROM "InvoicePayment" WHERE account_id = ${sourceId}) AS src,
                (SELECT COUNT(*)::int FROM map_erp_payment) AS mapped
        `);
        if (paymentCounts[0]?.src !== paymentCounts[0]?.mapped) {
            throw new Error("Could not match every demo payment back to the source reference");
        }
        await tx.$executeRawUnsafe(`
            UPDATE "InvoicePayment"
            SET reference = 'tmp-' || id::text
            WHERE account_id = ${targetId}
        `);
        await tx.$executeRawUnsafe(`
            UPDATE "InvoicePayment" d
            SET reference = m.reference,
                invoice_number = m.invoice_number
            FROM map_erp_payment m
            WHERE d.id = m.new_id
        `);

        await tx.$executeRawUnsafe(`
            UPDATE "CustomerPolicy" cp
            SET customer_number_policy = m.customer_number
            FROM map_erp_customer m
            WHERE cp.customer_number_policy = m.fake_number
              AND cp.customer_id IN (SELECT new_id FROM map_erp_customer)
        `);
        await tx.$executeRawUnsafe(`
            UPDATE "CustomerPolicyTrend" t
            SET customer_number_policy = m.customer_number
            FROM map_erp_customer m
            WHERE t.account_id = ${targetId}
              AND t.customer_number_policy = m.fake_number
        `);
        await tx.$executeRawUnsafe(`
            CREATE TEMP TABLE named_fix ON COMMIT DROP AS
            SELECT np.id, m.customer_number AS real_number
            FROM "NamedPolicy" np
            JOIN map_erp_customer m ON m.fake_number = np.customer_number
            WHERE np.insurance_policy_id IN (
                SELECT id FROM "InsurancePolicy" WHERE account_id = ${targetId}
            )
        `);
        await tx.$executeRawUnsafe(`
            UPDATE "NamedPolicy" np
            SET customer_number = 'tmp-' || np.id::text
            FROM named_fix f
            WHERE np.id = f.id
        `);
        await tx.$executeRawUnsafe(`
            UPDATE "NamedPolicy" np
            SET customer_number = f.real_number
            FROM named_fix f
            WHERE np.id = f.id
        `);
        await tx.$executeRawUnsafe(`
            UPDATE "NamedPolicyTrend" t
            SET customer_number = m.customer_number
            FROM map_erp_customer m
            WHERE t.account_id = ${targetId}
              AND t.customer_number = m.fake_number
        `);
    }

    const buUpdated = await tx.$executeRawUnsafe(`
        UPDATE "BusinessUnit" d
        SET external_id = s.external_id
        FROM (
            SELECT external_id, row_number() OVER (ORDER BY id) AS n
            FROM "BusinessUnit"
            WHERE account_id = ${sourceId}
        ) s
        WHERE d.account_id = ${targetId}
          AND d.name = 'Unit ' || s.n::text
    `);
    if (buUpdated === 0) {
        throw new Error("Could not restore business unit external ids");
    }

    // Fake C###### / INV- / PAY- ids were already restored (e.g. prior --target
    // run, or ERP incremental sync). Skip the strict 1:1 source match — the
    // demo may have drifted — and only refuse leftover tmp- swap rows.
    if ((pending[0]?.n ?? 0) === 0) {
        const tmpLeft = await tx.$queryRawUnsafe<Array<{ n: number }>>(`
            SELECT (
                (SELECT COUNT(*) FROM "Customer" WHERE account_id = ${targetId} AND customer_number LIKE 'tmp-%')
                + (SELECT COUNT(*) FROM "Invoice" WHERE account_id = ${targetId} AND invoice_number LIKE 'tmp-%')
                + (SELECT COUNT(*) FROM "InvoicePayment" WHERE account_id = ${targetId} AND reference LIKE 'tmp-%')
            )::int AS n
        `);
        if ((tmpLeft[0]?.n ?? 0) !== 0) {
            throw new Error("Demo billing ids still have tmp- swap leftovers");
        }
        return;
    }

    const mismatch = await tx.$queryRawUnsafe<Array<{ n: number }>>(`
        SELECT (
            (SELECT COUNT(*) FROM "Customer" s
             WHERE s.account_id = ${sourceId}
               AND NOT EXISTS (
                   SELECT 1 FROM "Customer" d
                   WHERE d.account_id = ${targetId}
                     AND d.customer_number IS NOT DISTINCT FROM s.customer_number
                     AND d.crn IS NOT DISTINCT FROM s.crn
               ))
            + (SELECT COUNT(*) FROM "Invoice" s
               WHERE s.account_id = ${sourceId}
                 AND NOT EXISTS (
                     SELECT 1 FROM "Invoice" d
                     WHERE d.account_id = ${targetId}
                       AND d.invoice_number IS NOT DISTINCT FROM s.invoice_number
                 ))
            + (SELECT COUNT(*) FROM "InvoicePayment" s
               WHERE s.account_id = ${sourceId}
                 AND NOT EXISTS (
                     SELECT 1 FROM "InvoicePayment" d
                     WHERE d.account_id = ${targetId}
                       AND d.reference = s.reference
                       AND d.invoice_number IS NOT DISTINCT FROM s.invoice_number
                 ))
            + (SELECT COUNT(*) FROM "Customer" WHERE account_id = ${targetId} AND customer_number LIKE 'tmp-%')
            + (SELECT COUNT(*) FROM "Invoice" WHERE account_id = ${targetId} AND invoice_number LIKE 'tmp-%')
            + (SELECT COUNT(*) FROM "InvoicePayment" WHERE account_id = ${targetId} AND reference LIKE 'tmp-%')
        )::int AS n
    `);
    if ((mismatch[0]?.n ?? 1) !== 0) {
        throw new Error("Demo billing ids still do not match the source");
    }
}

/**
 * Re-copy live credit/financial fields from source → existing demo so ERP drift
 * does not leave the credit dashboard out of sync. Requires temp map_policy.
 */
async function syncDemoLiveCreditData(
    tx: Tx,
    sourceId: number,
    targetId: number
): Promise<{
    invoicesUpdated: number;
    invoicesNeutralized: number;
    paymentsUpdated: number;
    paymentsNeutralized: number;
    customersUpdated: number;
    customerPoliciesUpdated: number;
    namedPoliciesUpdated: number;
    topUpsUpdated: number;
    insurancePoliciesUpdated: number;
    customerPolicyTrends: number;
    insurancePolicyTrends: number;
    namedPolicyTrends: number;
    collectionPeriods: number;
    disputes: number;
}> {
    await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE map_customer_num (
            old_id int PRIMARY KEY,
            new_id int NOT NULL UNIQUE,
            customer_number text
        ) ON COMMIT DROP
    `);
    await tx.$executeRawUnsafe(`
        INSERT INTO map_customer_num (old_id, new_id, customer_number)
        SELECT s.id, d.id, s.customer_number
        FROM "Customer" s
        JOIN "Customer" d
          ON d.account_id = ${targetId}
         AND d.customer_number IS NOT DISTINCT FROM s.customer_number
        WHERE s.account_id = ${sourceId}
    `);

    const invoicesUpdated = await tx.$executeRawUnsafe(`
        UPDATE "Invoice" t SET
            amount = s.amount,
            amount_without_vat = s.amount_without_vat,
            vat_amount = s.vat_amount,
            net_amount = s.net_amount,
            total_paid = s.total_paid,
            outstanding_debt = s.outstanding_debt,
            customer_amount = s.customer_amount,
            customer_amount_without_vat = s.customer_amount_without_vat,
            customer_vat_amount = s.customer_vat_amount,
            customer_net_amount = s.customer_net_amount,
            customer_total_paid = s.customer_total_paid,
            customer_outstanding_debt = s.customer_outstanding_debt,
            customer_currency = s.customer_currency,
            status = s.status,
            due_date = s.due_date,
            invoice_date = s.invoice_date,
            close_date = s.close_date,
            last_payment_date = s.last_payment_date,
            oldest_overdue_invoice_date = s.oldest_overdue_invoice_date,
            payment_term = s.payment_term,
            target_reporting_date = s.target_reporting_date,
            actual_reporting_date = s.actual_reporting_date,
            target_mep_date = s.target_mep_date,
            reported_status = s.reported_status,
            reporting_breach = s.reporting_breach,
            ctv_payment_term = s.ctv_payment_term,
            ctv_customer_overdue_mep = s.ctv_customer_overdue_mep,
            ctv_customer_overdue_mep_cause_invoice_number = s.ctv_customer_overdue_mep_cause_invoice_number,
            ctv_customer_overdue_mep_cause_due_date = s.ctv_customer_overdue_mep_cause_due_date,
            ctv_customer_overdue_mep_cause_outstanding = s.ctv_customer_overdue_mep_cause_outstanding,
            ctv_customer_overdue_mep_days_past = s.ctv_customer_overdue_mep_days_past,
            ctv_customer_excluded_from_policy = s.ctv_customer_excluded_from_policy,
            ctv_outdated_dcl = s.ctv_outdated_dcl,
            ctv_invoice_after_policy_end = s.ctv_invoice_after_policy_end,
            in_capacity_gap = s.in_capacity_gap,
            mep_ignored = s.mep_ignored,
            limit_assessed_amount = s.limit_assessed_amount,
            limit_assessed_at = s.limit_assessed_at,
            limit_assessed_currency = s.limit_assessed_currency,
            capacity_gap_amount = s.capacity_gap_amount,
            capacity_gap_amount_limit = s.capacity_gap_amount_limit,
            capacity_gap_amount_date = s.capacity_gap_amount_date,
            zero_limit_alert = s.zero_limit_alert,
            policy_id = CASE
                WHEN s.policy_id IS NULL THEN NULL
                ELSE (SELECT new_id FROM map_policy mp WHERE mp.old_id = s.policy_id)
            END,
            modified_at = NOW(),
            modified_by = NULL
        FROM "Invoice" s
        WHERE s.account_id = ${sourceId}
          AND t.account_id = ${targetId}
          AND t.invoice_number IS NOT DISTINCT FROM s.invoice_number
    `);

    const invoicesNeutralized = await tx.$executeRawUnsafe(`
        UPDATE "Invoice" t SET
            outstanding_debt = 0,
            customer_outstanding_debt = 0,
            total_paid = COALESCE(amount, 0),
            customer_total_paid = COALESCE(customer_amount, 0),
            status = 'Paid'::invoice_status,
            close_date = COALESCE(close_date, CURRENT_DATE),
            in_capacity_gap = false,
            capacity_gap_amount = 0,
            capacity_gap_amount_limit = 0,
            reporting_breach = false,
            ctv_payment_term = false,
            ctv_customer_overdue_mep = false,
            ctv_customer_excluded_from_policy = false,
            ctv_outdated_dcl = false,
            ctv_invoice_after_policy_end = false,
            ctv_customer_overdue_mep_cause_invoice_number = NULL,
            ctv_customer_overdue_mep_cause_due_date = NULL,
            ctv_customer_overdue_mep_cause_outstanding = NULL,
            ctv_customer_overdue_mep_days_past = NULL,
            collection_period_id = NULL,
            modified_at = NOW(),
            modified_by = NULL
        WHERE t.account_id = ${targetId}
          AND NOT EXISTS (
            SELECT 1 FROM "Invoice" s
            WHERE s.account_id = ${sourceId}
              AND s.invoice_number IS NOT DISTINCT FROM t.invoice_number
          )
    `);

    const paymentsUpdated = await tx.$executeRawUnsafe(`
        UPDATE "InvoicePayment" t SET
            amount = s.amount,
            customer_amount = s.customer_amount,
            payment_date = s.payment_date,
            customer_currency = s.customer_currency,
            invoice_number = s.invoice_number,
            invoice_id = (
                SELECT d.id FROM "Invoice" src
                JOIN "Invoice" d
                  ON d.account_id = ${targetId}
                 AND d.invoice_number IS NOT DISTINCT FROM src.invoice_number
                WHERE src.id = s.invoice_id
                LIMIT 1
            ),
            modified_at = NOW(),
            modified_by = NULL
        FROM "InvoicePayment" s
        JOIN map_customer_num mc ON mc.old_id = s.customer_id
        WHERE s.account_id = ${sourceId}
          AND t.account_id = ${targetId}
          AND t.customer_id = mc.new_id
          AND t.reference IS NOT DISTINCT FROM s.reference
    `);

    const paymentsNeutralized = await tx.$executeRawUnsafe(`
        UPDATE "InvoicePayment" t SET
            amount = 0,
            customer_amount = 0,
            modified_at = NOW(),
            modified_by = NULL
        WHERE t.account_id = ${targetId}
          AND COALESCE(t.amount, 0) <> 0
          AND NOT EXISTS (
            SELECT 1
            FROM "InvoicePayment" s
            JOIN map_customer_num mc ON mc.old_id = s.customer_id
            WHERE s.account_id = ${sourceId}
              AND t.customer_id = mc.new_id
              AND s.reference IS NOT DISTINCT FROM t.reference
          )
    `);

    const customersUpdated = await tx.$executeRawUnsafe(`
        UPDATE "Customer" t SET
            overdue_block = s.overdue_block,
            zero_limit_alert_exist = s.zero_limit_alert_exist,
            oldest_invoice_overdue_date = s.oldest_invoice_overdue_date,
            oldest_invoice_overdue_date_all = s.oldest_invoice_overdue_date_all,
            total_due_amount = s.total_due_amount,
            total_overdue_amount = s.total_overdue_amount,
            total_invoices_overdue = s.total_invoices_overdue,
            number_of_overdue_invoices = s.number_of_overdue_invoices,
            no_of_due_invoices = s.no_of_due_invoices,
            collection_status = s.collection_status,
            parent_customer_id = (
                SELECT mc.new_id FROM map_customer_num mc
                WHERE mc.old_id = s.parent_customer_id
            ),
            modified_at = NOW()
        FROM "Customer" s
        JOIN map_customer_num mc ON mc.old_id = s.id
        WHERE s.account_id = ${sourceId}
          AND t.id = mc.new_id
    `);

    const customerPoliciesUpdated = await tx.$executeRawUnsafe(`
        UPDATE "CustomerPolicy" t SET
            approved_limit = s.approved_limit,
            approved_limit_currency = s.approved_limit_currency,
            approved_limit_expiration_date = s.approved_limit_expiration_date,
            zero_limit_date = s.zero_limit_date,
            limit_type = s.limit_type,
            max_payment_term = s.max_payment_term,
            max_allowed_mep = s.max_allowed_mep,
            reporting_days = s.reporting_days,
            mep_cutoff_day = s.mep_cutoff_day,
            mep_substitute_extra_days = s.mep_substitute_extra_days,
            reporting_cutoff_day = s.reporting_cutoff_day,
            reporting_substitute_extra_days = s.reporting_substitute_extra_days,
            payment_term_cutoff_day = s.payment_term_cutoff_day,
            payment_term_substitute_day = s.payment_term_substitute_day,
            excluded_from_policy = s.excluded_from_policy,
            credit_score = s.credit_score,
            credit_score_input_date = s.credit_score_input_date,
            active_customer_since = s.active_customer_since,
            outdated_dcl = s.outdated_dcl,
            capacity_gap_amount = s.capacity_gap_amount,
            capacity_gap_amount_date = s.capacity_gap_amount_date,
            retained_capacity_gap = s.retained_capacity_gap,
            uninsured_amount = s.uninsured_amount,
            capacity_gap_amount1 = s.capacity_gap_amount1,
            capacity_gap_currency1 = s.capacity_gap_currency1,
            capacity_gap_amount2 = s.capacity_gap_amount2,
            capacity_gap_currency2 = s.capacity_gap_currency2,
            uninsured_amount1 = s.uninsured_amount1,
            uninsured_currency1 = s.uninsured_currency1,
            uninsured_amount2 = s.uninsured_amount2,
            uninsured_currency2 = s.uninsured_currency2,
            customer_number_policy = s.customer_number_policy,
            modified_at = NOW()
        FROM "CustomerPolicy" s
        JOIN map_customer_num mc ON mc.old_id = s.customer_id
        JOIN map_policy mp ON mp.old_id = s.insurance_policy_id
        WHERE t.customer_id = mc.new_id
          AND t.insurance_policy_id = mp.new_id
          AND t.is_active = s.is_active
          AND t.status = s.status
    `);

    const namedPoliciesUpdated = await tx.$executeRawUnsafe(`
        UPDATE "NamedPolicy" t SET
            max_payment_term = s.max_payment_term,
            customer_mep = s.customer_mep,
            reporting_days = s.reporting_days,
            customer_max_limit = s.customer_max_limit,
            limit_expiration_date = s.limit_expiration_date,
            modified_at = NOW()
        FROM "NamedPolicy" s
        JOIN map_policy mp ON mp.old_id = s.insurance_policy_id
        WHERE t.insurance_policy_id = mp.new_id
          AND t.customer_number = s.customer_number
    `);

    const topUpsUpdated = await tx.$executeRawUnsafe(`
        UPDATE "CustomerTopUp" t SET
            top_up_type = s.top_up_type,
            top_up_value = s.top_up_value,
            currency = s.currency,
            start_date = s.start_date,
            end_date = s.end_date,
            premium = s.premium,
            premium_currency = s.premium_currency,
            cancelled_at = s.cancelled_at,
            notes = NULL,
            modified_at = NOW()
        FROM "CustomerTopUp" s
        JOIN map_customer_num mc ON mc.old_id = s.customer_id
        LEFT JOIN map_policy mp ON mp.old_id = s.insurance_policy_id
        WHERE t.customer_id = mc.new_id
          AND t.insurance_policy_id IS NOT DISTINCT FROM mp.new_id
          AND t.start_date IS NOT DISTINCT FROM s.start_date
          AND t.top_up_type IS NOT DISTINCT FROM s.top_up_type
    `);

    // Keep demo scrubbed policy_number / insurer_name; sync terms + dates.
    const insurancePoliciesUpdated = await tx.$executeRawUnsafe(`
        UPDATE "InsurancePolicy" t SET
            start_date = s.start_date,
            end_date = s.end_date,
            currency = s.currency,
            policy_kind = s.policy_kind,
            allow_concurrent_top_ups = s.allow_concurrent_top_ups,
            max_total_cover = s.max_total_cover,
            max_total_dcl_sdl_cover = s.max_total_dcl_sdl_cover,
            min_credit_score = s.min_credit_score,
            score_validity_period_months = s.score_validity_period_months,
            max_dcl = s.max_dcl,
            dcl_customer_since_months = s.dcl_customer_since_months,
            max_payment_term = s.max_payment_term,
            max_allowed_mep = s.max_allowed_mep,
            reporting_days = s.reporting_days,
            mep_cutoff_day = s.mep_cutoff_day,
            mep_substitute_extra_days = s.mep_substitute_extra_days,
            reporting_cutoff_day = s.reporting_cutoff_day,
            reporting_substitute_extra_days = s.reporting_substitute_extra_days,
            payment_term_cutoff_day = s.payment_term_cutoff_day,
            payment_term_substitute_day = s.payment_term_substitute_day,
            cost_calculation_method = s.cost_calculation_method,
            cost_percent = s.cost_percent,
            registration_fee_percent = s.registration_fee_percent,
            annual_credit_assessment_fee = s.annual_credit_assessment_fee,
            insured_percentage = s.insured_percentage,
            non_qualifying_loss_threshold = s.non_qualifying_loss_threshold,
            minimum_premium = s.minimum_premium,
            minimum_premium_period_years = s.minimum_premium_period_years,
            aggregate_excess = s.aggregate_excess,
            sdl_excess = s.sdl_excess,
            ncb_zero_claims_bonus_percent = s.ncb_zero_claims_bonus_percent,
            ncb_claims_ratio_threshold_percent = s.ncb_claims_ratio_threshold_percent,
            ncb_up_to_threshold_bonus_percent = s.ncb_up_to_threshold_bonus_percent,
            product_type = s.product_type,
            status = s.status,
            modified_at = NOW()
        FROM "InsurancePolicy" s
        JOIN map_policy mp ON mp.old_id = s.id
        WHERE t.id = mp.new_id
    `);

    await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE map_cpolicy_refresh (
            old_id int PRIMARY KEY,
            new_id int NOT NULL
        ) ON COMMIT DROP
    `);
    await tx.$executeRawUnsafe(`
        INSERT INTO map_cpolicy_refresh (old_id, new_id)
        SELECT s.id, t.id
        FROM "CustomerPolicy" s
        JOIN map_customer_num mc ON mc.old_id = s.customer_id
        JOIN map_policy mp ON mp.old_id = s.insurance_policy_id
        JOIN "CustomerPolicy" t
          ON t.customer_id = mc.new_id
         AND t.insurance_policy_id = mp.new_id
         AND t.is_active = s.is_active
         AND t.status = s.status
    `);
    await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE map_named_refresh (
            old_id int PRIMARY KEY,
            new_id int NOT NULL
        ) ON COMMIT DROP
    `);
    await tx.$executeRawUnsafe(`
        INSERT INTO map_named_refresh (old_id, new_id)
        SELECT s.id, t.id
        FROM "NamedPolicy" s
        JOIN map_policy mp ON mp.old_id = s.insurance_policy_id
        JOIN "NamedPolicy" t
          ON t.insurance_policy_id = mp.new_id
         AND t.customer_number IS NOT DISTINCT FROM s.customer_number
    `);

    await syncSequence(tx, "CustomerPolicyTrend");
    await syncSequence(tx, "InsurancePolicyTrend");
    await syncSequence(tx, "NamedPolicyTrend");
    await tx.$executeRawUnsafe(`
        DELETE FROM "CustomerPolicyTrend" WHERE account_id = ${targetId}
    `);
    await tx.$executeRawUnsafe(`
        DELETE FROM "InsurancePolicyTrend" WHERE account_id = ${targetId}
    `);
    await tx.$executeRawUnsafe(`
        DELETE FROM "NamedPolicyTrend" WHERE account_id = ${targetId}
    `);
    const customerPolicyTrends = await insertCopy(tx, "CustomerPolicyTrend", {
        from: `FROM "CustomerPolicyTrend" s
               JOIN map_customer_num mc ON mc.old_id = s.customer_id`,
        where: `s.account_id = ${sourceId}
          AND (
            s.customer_policy_id IS NULL
            OR EXISTS (
                SELECT 1 FROM map_cpolicy_refresh mcr
                WHERE mcr.old_id = s.customer_policy_id
            )
          )`,
        overrides: {
            account_id: `${targetId}`,
            customer_id: "mc.new_id",
            insurance_policy_id: `(SELECT new_id FROM map_policy WHERE old_id = s.insurance_policy_id)`,
            customer_policy_id: `(SELECT new_id FROM map_cpolicy_refresh WHERE old_id = s.customer_policy_id)`,
        },
    });
    const insurancePolicyTrends = await insertCopy(tx, "InsurancePolicyTrend", {
        from: `FROM "InsurancePolicyTrend" s JOIN map_policy p ON p.old_id = s.insurance_policy_id`,
        where: "true",
        overrides: {
            account_id: `${targetId}`,
            insurance_policy_id: "p.new_id",
            policy_number: `(SELECT policy_number FROM "InsurancePolicy" WHERE id = p.new_id)`,
            insurer_name: `(SELECT insurer_name FROM "InsurancePolicy" WHERE id = p.new_id)`,
            parent_insurance_policy_id: `(SELECT new_id FROM map_policy WHERE old_id = s.parent_insurance_policy_id)`,
        },
    });
    const namedPolicyTrends = await insertCopy(tx, "NamedPolicyTrend", {
        from: `FROM "NamedPolicyTrend" s
               JOIN map_named_refresh n ON n.old_id = s.named_policy_id
               JOIN map_policy p ON p.old_id = s.insurance_policy_id`,
        where: "true",
        overrides: {
            account_id: `${targetId}`,
            insurance_policy_id: "p.new_id",
            named_policy_id: "n.new_id",
        },
    });

    // Replace collection periods + disputes so financial-dashboard widgets match.
    for (const table of [
        "CustomerCollectionPeriod",
        "CustomerDispute",
        "DisputeInvoice",
    ]) {
        await syncSequence(tx, table);
    }
    await tx.$executeRawUnsafe(`
        UPDATE "Invoice" SET collection_period_id = NULL
        WHERE account_id = ${targetId} AND collection_period_id IS NOT NULL
    `);
    await tx.$executeRawUnsafe(`
        DELETE FROM "DisputeInvoice" di
        USING "CustomerDispute" d
        JOIN map_customer_num mc ON mc.new_id = d.customer_id
        WHERE di.dispute_id = d.id
    `);
    await tx.$executeRawUnsafe(`
        DELETE FROM "CustomerDispute" d
        USING map_customer_num mc
        WHERE d.customer_id = mc.new_id
    `);
    await tx.$executeRawUnsafe(`
        DELETE FROM "CustomerCollectionPeriod" ccp
        USING map_customer_num mc
        WHERE ccp.customer_id = mc.new_id
    `);

    await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE map_period (
            old_id int PRIMARY KEY,
            new_id int NOT NULL UNIQUE
        ) ON COMMIT DROP
    `);
    await tx.$executeRawUnsafe(`
        INSERT INTO map_period (old_id, new_id)
        SELECT s.id,
               nextval(pg_get_serial_sequence('"CustomerCollectionPeriod"', 'id'))::int
        FROM "CustomerCollectionPeriod" s
        JOIN map_customer_num mc ON mc.old_id = s.customer_id
    `);
    const collectionPeriods = await insertCopy(tx, "CustomerCollectionPeriod", {
        from: `FROM "CustomerCollectionPeriod" s JOIN map_period m ON m.old_id = s.id JOIN map_customer_num mc ON mc.old_id = s.customer_id`,
        where: "true",
        includeId: true,
        overrides: {
            id: "m.new_id",
            customer_id: "mc.new_id",
            create_next_activity: "false",
            created_by: "NULL",
            modified_by: "NULL",
        },
    });

    await tx.$executeRawUnsafe(`
        UPDATE "Invoice" d SET
            collection_period_id = mp.new_id,
            modified_at = NOW()
        FROM "Invoice" s
        JOIN map_period mp ON mp.old_id = s.collection_period_id
        WHERE s.account_id = ${sourceId}
          AND d.account_id = ${targetId}
          AND d.invoice_number IS NOT DISTINCT FROM s.invoice_number
          AND s.collection_period_id IS NOT NULL
    `);

    await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE map_dispute (
            old_id int PRIMARY KEY,
            new_id int NOT NULL UNIQUE
        ) ON COMMIT DROP
    `);
    await tx.$executeRawUnsafe(`
        INSERT INTO map_dispute (old_id, new_id)
        SELECT s.id,
               nextval(pg_get_serial_sequence('"CustomerDispute"', 'id'))::int
        FROM "CustomerDispute" s
        JOIN map_customer_num mc ON mc.old_id = s.customer_id
    `);
    // Dispute reasons were cloned with the account; remap by name when possible.
    await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE map_reason_refresh (
            old_id int PRIMARY KEY,
            new_id int NOT NULL
        ) ON COMMIT DROP
    `);
    await tx.$executeRawUnsafe(`
        INSERT INTO map_reason_refresh (old_id, new_id)
        SELECT s.id, d.id
        FROM "DisputeReason" s
        JOIN "DisputeReason" d
          ON d.account_id = ${targetId}
         AND d.name IS NOT DISTINCT FROM s.name
        WHERE s.account_id = ${sourceId}
    `);
    const disputes = await insertCopy(tx, "CustomerDispute", {
        from: `FROM "CustomerDispute" s JOIN map_dispute m ON m.old_id = s.id JOIN map_customer_num mc ON mc.old_id = s.customer_id`,
        where: "true",
        includeId: true,
        overrides: {
            id: "m.new_id",
            customer_id: "mc.new_id",
            dispute_reason_id: `(SELECT new_id FROM map_reason_refresh WHERE old_id = s.dispute_reason_id)`,
            customer_collection_period_id: `(SELECT new_id FROM map_period WHERE old_id = s.customer_collection_period_id)`,
            customer_comment: "NULL",
            resolution_comment: "NULL",
            contact_first_name: "NULL",
            contact_last_name: "NULL",
            contact_email: "NULL",
            contact_mobile: "NULL",
            created_by: "NULL",
            modified_by: "NULL",
            owner_id: "NULL",
        },
    });
    await insertCopy(tx, "DisputeInvoice", {
        from: `FROM "DisputeInvoice" s JOIN map_dispute md ON md.old_id = s.dispute_id`,
        where: `EXISTS (
            SELECT 1 FROM "Invoice" src
            JOIN "Invoice" d
              ON d.account_id = ${targetId}
             AND d.invoice_number IS NOT DISTINCT FROM src.invoice_number
            WHERE src.id = s.invoice_id
        )`,
        overrides: {
            dispute_id: "md.new_id",
            invoice_id: `(
                SELECT d.id FROM "Invoice" src
                JOIN "Invoice" d
                  ON d.account_id = ${targetId}
                 AND d.invoice_number IS NOT DISTINCT FROM src.invoice_number
                WHERE src.id = s.invoice_id
                LIMIT 1
            )`,
            created_by: "NULL",
            modified_by: "NULL",
        },
    });

    return {
        invoicesUpdated: Number(invoicesUpdated),
        invoicesNeutralized: Number(invoicesNeutralized),
        paymentsUpdated: Number(paymentsUpdated),
        paymentsNeutralized: Number(paymentsNeutralized),
        customersUpdated: Number(customersUpdated),
        customerPoliciesUpdated: Number(customerPoliciesUpdated),
        namedPoliciesUpdated: Number(namedPoliciesUpdated),
        topUpsUpdated: Number(topUpsUpdated),
        insurancePoliciesUpdated: Number(insurancePoliciesUpdated),
        customerPolicyTrends: Number(customerPolicyTrends),
        insurancePolicyTrends: Number(insurancePolicyTrends),
        namedPolicyTrends: Number(namedPolicyTrends),
        collectionPeriods: Number(collectionPeriods),
        disputes: Number(disputes),
    };
}

async function backfillExistingDemo(
    prisma: PrismaClient,
    sourceId: number,
    targetId: number
): Promise<void> {
    if (targetId === sourceId || targetId === 10013) {
        throw new Error("Refusing to update that account");
    }
    const target = await prisma.account.findUnique({
        where: { id: targetId },
        select: { id: true, name: true, is_demo: true },
    });
    if (!target?.is_demo) {
        throw new Error(`Account ${targetId} is not a demo account`);
    }

    const connectors = await prisma.billingConnector.findMany({
        where: { account_id: targetId },
        select: { id: true, sync_enabled: true },
    });
    const pausedSyncIds: number[] = [];
    for (const connector of connectors) {
        if (connector.sync_enabled) {
            await prisma.billingConnector.update({
                where: { id: connector.id },
                data: { sync_enabled: false },
            });
            pausedSyncIds.push(connector.id);
        }
    }

    try {
        const result = await prisma.$transaction(
            async (tx) => {
                await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15min'`);
                await tx.$executeRawUnsafe(`
                    CREATE TEMP TABLE map_policy (old_id int PRIMARY KEY, new_id int NOT NULL) ON COMMIT DROP
                `);
                await tx.$executeRawUnsafe(`
                    INSERT INTO map_policy (old_id, new_id)
                    SELECT s.id, d.id
                    FROM (
                        SELECT id, row_number() OVER (ORDER BY id) AS n
                        FROM "InsurancePolicy"
                        WHERE account_id = ${sourceId}
                    ) s
                    JOIN (
                        SELECT id, row_number() OVER (ORDER BY id) AS n
                        FROM "InsurancePolicy"
                        WHERE account_id = ${targetId}
                    ) d ON d.n = s.n
                `);
                await tx.$executeRawUnsafe(`
                    CREATE TEMP TABLE map_bu (old_id int PRIMARY KEY, new_id int NOT NULL) ON COMMIT DROP
                `);
                await tx.$executeRawUnsafe(`
                    INSERT INTO map_bu (old_id, new_id)
                    SELECT s.id, d.id
                    FROM (
                        SELECT id, row_number() OVER (ORDER BY id) AS n
                        FROM "BusinessUnit"
                        WHERE account_id = ${sourceId}
                    ) s
                    JOIN (
                        SELECT id, substring(name from 'Unit ([0-9]+)')::int AS n
                        FROM "BusinessUnit"
                        WHERE account_id = ${targetId}
                    ) d ON d.n = s.n
                `);

                const live = await syncDemoLiveCreditData(tx, sourceId, targetId);

                // Re-align financial-dashboard source dates so newest invoice = today.
                const financialShiftRows = await tx.$queryRawUnsafe<
                    Array<{ delta: number }>
                >(`
                    SELECT (CURRENT_DATE - COALESCE(MAX(invoice_date), CURRENT_DATE))::int AS delta
                    FROM "Invoice"
                    WHERE account_id = ${targetId}
                `);
                const financialShiftDays = financialShiftRows[0]?.delta ?? 0;
                const financialShiftWhere: Array<[string, string]> = [
                    ["Account", `id = ${targetId}`],
                    ["Invoice", `account_id = ${targetId}`],
                    ["InvoicePayment", `account_id = ${targetId}`],
                    ["Customer", `account_id = ${targetId}`],
                    [
                        "CustomerCollectionPeriod",
                        `customer_id IN (SELECT id FROM "Customer" WHERE account_id = ${targetId})`,
                    ],
                    [
                        "CustomerDispute",
                        `customer_id IN (SELECT id FROM "Customer" WHERE account_id = ${targetId})`,
                    ],
                    [
                        "CustomerPolicy",
                        `customer_id IN (SELECT id FROM "Customer" WHERE account_id = ${targetId})`,
                    ],
                    [
                        "CustomerTopUp",
                        `customer_id IN (SELECT id FROM "Customer" WHERE account_id = ${targetId})`,
                    ],
                    ["CustomerPolicyTrend", `account_id = ${targetId}`],
                    ["InsurancePolicy", `account_id = ${targetId}`],
                    ["InsurancePolicyTrend", `account_id = ${targetId}`],
                    ["InsurancePolicyCountryTrend", `account_id = ${targetId}`],
                    [
                        "NamedPolicy",
                        `insurance_policy_id IN (SELECT id FROM "InsurancePolicy" WHERE account_id = ${targetId})`,
                    ],
                    ["NamedPolicyTrend", `account_id = ${targetId}`],
                    ["CustomerCheckpoint", `account_id = ${targetId}`],
                ];
                for (const [table, whereSql] of financialShiftWhere) {
                    await shiftDates(tx, table, whereSql, financialShiftDays);
                }
                // Snapshots are copied from the source; shift them so their timeline
                // lands on today independently of how far the target had drifted.
                const snapshotDeltaRows = await tx.$queryRawUnsafe<
                    Array<{ delta: number }>
                >(`
                    SELECT (CURRENT_DATE - COALESCE(MAX(invoice_date), CURRENT_DATE))::int AS delta
                    FROM "Invoice"
                    WHERE account_id = ${sourceId}
                `);
                const snapshotDeltaDays = snapshotDeltaRows[0]?.delta ?? 0;
                await restoreErpIdentifiers(tx, sourceId, targetId);
                const snapshots = await copyCreditDashboardSnapshots(
                    tx,
                    sourceId,
                    targetId,
                    snapshotDeltaDays
                );
                await tx.$executeRawUnsafe(`
                    DELETE FROM "DashboardCache" WHERE account_id = ${targetId}
                `);
                const counts = await tx.$queryRawUnsafe<
                    Array<{
                        invoices: number;
                        payments: number;
                        collection_periods: number;
                        disputes: number;
                        snapshots: number;
                        recent: number;
                    }>
                >(`
                    SELECT
                        (SELECT COUNT(*)::int FROM "Invoice" WHERE account_id = ${targetId}) AS invoices,
                        (SELECT COUNT(*)::int FROM "InvoicePayment" WHERE account_id = ${targetId}) AS payments,
                        (SELECT COUNT(*)::int FROM "CustomerCollectionPeriod" ccp
                         JOIN "Customer" c ON c.id = ccp.customer_id
                         WHERE c.account_id = ${targetId}) AS collection_periods,
                        (SELECT COUNT(*)::int FROM "CustomerDispute" d
                         JOIN "Customer" c ON c.id = d.customer_id
                         WHERE c.account_id = ${targetId}) AS disputes,
                        (SELECT COUNT(*)::int FROM "CreditDashboardDailySnapshot" WHERE account_id = ${targetId}) AS snapshots,
                        (SELECT COUNT(*)::int FROM "CreditDashboardDailySnapshot"
                         WHERE account_id = ${targetId}
                           AND policy_id IS NULL
                           AND business_unit_id IS NULL
                           AND snapshot_date >= CURRENT_DATE - 30
                           AND snapshot_date <= CURRENT_DATE) AS recent
                `);
                return {
                    financialShiftDays,
                    snapshotDeltaDays,
                    snapshots,
                    live,
                    ...counts[0],
                };
            },
            { timeout: 900_000, maxWait: 60_000 }
        );
        console.log(
            JSON.stringify(
                {
                    sourceAccountId: sourceId,
                    demoAccountId: targetId,
                    name: target.name,
                    financialDateShiftDays: result.financialShiftDays,
                    snapshotDateShiftDays: result.snapshotDeltaDays,
                    liveSync: result.live,
                    invoices: result.invoices,
                    payments: result.payments,
                    collectionPeriods: result.collection_periods,
                    disputes: result.disputes,
                    snapshots: result.snapshots,
                    recentAccountWideDays: result.recent,
                    pausedBillingSyncConnectorIds: pausedSyncIds,
                },
                null,
                2
            )
        );
    } finally {
        for (const id of pausedSyncIds) {
            await prisma.billingConnector.update({
                where: { id },
                data: { sync_enabled: true },
            });
        }
    }
}

async function main(): Promise<void> {
    const sourceId = requireInt("--source", 10149);
    const targetId = argValue("--target");
    const dryRun = process.argv.includes("--dry-run");
    const accountName = argValue("--name") ?? "Demo Portfolio";
    const username = argValue("--username") ?? "demo.portfolio.admin";
    const email = argValue("--email") ?? "demo.portfolio.admin@example.com";
    const password = argValue("--password");
    if (sourceId === 10013) {
        throw new Error("Refusing to clone admin account 10013");
    }
    if (!targetId && !dryRun && !password) {
        throw new Error("--password is required");
    }
    if (password && password.length < 8) {
        throw new Error("--password must be at least 8 characters");
    }

    const prisma = new PrismaClient();
    const source = await prisma.account.findUnique({
        where: { id: sourceId },
        select: { id: true, name: true, sub_domain: true, is_demo: true },
    });
    if (!source) {
        throw new Error(`Account ${sourceId} was not found`);
    }

    const counts = await prisma.$queryRaw<Array<{ table_name: string; n: number }>>`
        SELECT 'Customer' AS table_name, COUNT(*)::int AS n FROM "Customer" WHERE account_id = ${sourceId}
        UNION ALL SELECT 'Invoice', COUNT(*)::int FROM "Invoice" WHERE account_id = ${sourceId}
        UNION ALL SELECT 'InvoicePayment', COUNT(*)::int FROM "InvoicePayment" WHERE account_id = ${sourceId}
        UNION ALL SELECT 'CustomerCollectionPeriod', COUNT(*)::int FROM "CustomerCollectionPeriod" ccp
            JOIN "Customer" c ON c.id = ccp.customer_id WHERE c.account_id = ${sourceId}
        UNION ALL SELECT 'CustomerDispute', COUNT(*)::int FROM "CustomerDispute" d
            JOIN "Customer" c ON c.id = d.customer_id WHERE c.account_id = ${sourceId}
        UNION ALL SELECT 'CustomerPolicyTrend', COUNT(*)::int FROM "CustomerPolicyTrend" WHERE account_id = ${sourceId}
        UNION ALL SELECT 'InsurancePolicy', COUNT(*)::int FROM "InsurancePolicy" WHERE account_id = ${sourceId}
    `;
    console.log(
        `[clone-demo-account] source=${sourceId} customers=${counts.find((row) => row.table_name === "Customer")?.n} invoices=${counts.find((row) => row.table_name === "Invoice")?.n} collectionPeriods=${counts.find((row) => row.table_name === "CustomerCollectionPeriod")?.n} disputes=${counts.find((row) => row.table_name === "CustomerDispute")?.n}`
    );
    if (dryRun) {
        console.log("[clone-demo-account] dry run — no writes");
        await prisma.$disconnect();
        return;
    }
    if (targetId) {
        const parsedTarget = Number(targetId);
        if (!Number.isInteger(parsedTarget)) {
            throw new Error("--target must be an account id");
        }
        await backfillExistingDemo(prisma, sourceId, parsedTarget);
        await prisma.$disconnect();
        return;
    }

    const takenUser = await prisma.user.findFirst({
        where: { OR: [{ username }, { email }] },
        select: { id: true, username: true },
    });
    if (takenUser) {
        throw new Error(`Username or email is already in use (${username})`);
    }

    let subDomain = "demo-portfolio";
    const domainTaken = await prisma.account.findFirst({
        where: { sub_domain: subDomain },
        select: { id: true },
    });
    if (domainTaken) {
        subDomain = `demo-portfolio-${Date.now()}`;
    }

    const passwordHash = await bcrypt.hash(password as string, 10);
    const userId = randomUUID();

    const result = await prisma.$transaction(
        async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15min'`);
            for (const table of [
                "Account",
                "BusinessUnit",
                "RolePermission",
                "SequenceContainer",
                "ActivitiesTemplate",
                "ActivityTemplateLanguage",
                "ActivitiesSequence",
                "DisputeReason",
                "DisputeReasonLanguage",
                "InternalEmailTemplate",
                "InsurancePolicy",
                "Company",
                "Customer",
                "CustomerPolicy",
                "CustomerTopUp",
                "CustomerAggregatedData",
                "CustomerCollectionPeriod",
                "CustomerCheckpoint",
                "NamedPolicy",
                "Invoice",
                "InvoicePayment",
                "CustomerDispute",
                "DisputeInvoice",
                "CustomerPolicyTrend",
                "InsurancePolicyTrend",
                "InsurancePolicyCountryTrend",
                "NamedPolicyTrend",
                "CreditDashboardDailySnapshot",
                "Report",
            ]) {
                await syncSequence(tx, table);
            }
            await tx.$executeRawUnsafe(`
                CREATE TEMP TABLE demo_ctx (
                    user_id text NOT NULL,
                    account_id int
                ) ON COMMIT DROP
            `);
            await tx.$executeRaw`
                INSERT INTO demo_ctx (user_id) VALUES (${userId})
            `;

            const accountCols = await columns(tx, "Account");
            const accountOverrides: Record<string, string> = {
                name: sqlString(accountName),
                sub_domain: sqlString(subDomain),
                is_demo: "true",
                sso_enabled: "false",
                created_by: "NULL",
                modified_by: "NULL",
                deleted_by: "NULL",
            };
            for (const column of SECRET_ACCOUNT_COLUMNS) {
                accountOverrides[column] = "NULL";
            }
            const accountInsertCols = accountCols
                .filter((column) => column.column_name !== "id")
                .map((column) => sqlIdent(column.column_name))
                .join(", ");
            const accountSelectCols = accountCols
                .filter((column) => column.column_name !== "id")
                .map((column) => {
                    const override = accountOverrides[column.column_name];
                    if (override) {
                        return `${override} AS ${sqlIdent(column.column_name)}`;
                    }
                    return `s.${sqlIdent(column.column_name)}`;
                })
                .join(", ");
            const inserted = await tx.$queryRawUnsafe<Array<{ id: number }>>(`
                INSERT INTO "Account" (${accountInsertCols})
                SELECT ${accountSelectCols}
                FROM "Account" s
                WHERE s.id = ${sourceId}
                RETURNING id
            `);
            const newAccountId = inserted[0]?.id;
            if (!newAccountId) throw new Error("Account insert did not return an id");
            await tx.$executeRaw`
                UPDATE demo_ctx SET account_id = ${newAccountId}
            `;

            await tx.$executeRaw`
                INSERT INTO "User" (
                    id, name, first_name, last_name, email, username, password,
                    language, account_id, role, status,
                    time_zone, currency, locale, "emailVerified",
                    modified_at, sidebar_collapsed
                )
                SELECT ${userId},
                       'Demo Admin',
                       'Demo',
                       'Admin',
                       ${email},
                       ${username},
                       ${passwordHash},
                       COALESCE(a.default_language, 'Hebrew'::language),
                       ${newAccountId},
                       'System_Administrator'::user_role,
                       'Active'::record_status,
                       'Asia/Jerusalem',
                       COALESCE(a.currency, 'ILS'),
                       COALESCE(a.locale, 'he-IL'),
                       NOW(),
                       NOW(),
                       false
                FROM "Account" a
                WHERE a.id = ${newAccountId}
            `;
            await tx.$executeRaw`
                UPDATE "Account"
                SET created_by = ${userId}, modified_by = ${userId}
                WHERE id = ${newAccountId}
            `;

            await allocateMap(
                tx,
                "map_bu",
                `
                SELECT s.id,
                       nextval(pg_get_serial_sequence('"BusinessUnit"', 'id'))::int
                FROM "BusinessUnit" s
                WHERE s.account_id = ${sourceId}
                `
            );
            await insertCopy(tx, "BusinessUnit", {
                from: `FROM "BusinessUnit" s JOIN map_bu m ON m.old_id = s.id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    account_id: `${newAccountId}`,
                    parent_id: "NULL",
                    name: `'Unit ' || row_number() OVER (ORDER BY s.id)`,
                },
            });
            await relink(tx, "BusinessUnit", "parent_id", "map_bu");
            await tx.$executeRaw`
                UPDATE "User"
                SET business_unit_id = (
                    SELECT m.new_id
                    FROM map_bu m
                    JOIN "BusinessUnit" s ON s.id = m.old_id
                    ORDER BY s.is_primary DESC, s.id
                    LIMIT 1
                )
                WHERE id = ${userId}
            `;

            const copied: Record<string, number> = {};
            copied.BusinessUnit = await tx.$queryRaw<Array<{ n: number }>>`
                SELECT COUNT(*)::int AS n FROM "BusinessUnit" WHERE account_id = ${newAccountId}
            `.then((rows) => rows[0].n);

            copied.RolePermission = await insertCopy(tx, "RolePermission", {
                from: `FROM "RolePermission" s`,
                where: `s.account_id = ${sourceId}`,
                overrides: { account_id: `${newAccountId}` },
            });

            await allocateMap(
                tx,
                "map_sequence",
                `
                SELECT s.id, nextval(pg_get_serial_sequence('"SequenceContainer"', 'id'))::int
                FROM "SequenceContainer" s
                WHERE s.account_id = ${sourceId}
                `
            );
            copied.SequenceContainer = await insertCopy(tx, "SequenceContainer", {
                from: `FROM "SequenceContainer" s JOIN map_sequence m ON m.old_id = s.id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    account_id: `${newAccountId}`,
                },
            });

            await allocateMap(
                tx,
                "map_template",
                `
                SELECT s.id, nextval(pg_get_serial_sequence('"ActivitiesTemplate"', 'id'))::int
                FROM "ActivitiesTemplate" s
                WHERE s.account_id = ${sourceId}
                `
            );
            copied.ActivitiesTemplate = await insertCopy(tx, "ActivitiesTemplate", {
                from: `FROM "ActivitiesTemplate" s JOIN map_template m ON m.old_id = s.id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    account_id: `${newAccountId}`,
                },
            });
            copied.ActivityTemplateLanguage = await insertCopy(
                tx,
                "ActivityTemplateLanguage",
                {
                    from: `FROM "ActivityTemplateLanguage" s JOIN map_template m ON m.old_id = s.template_id`,
                    where: "true",
                    overrides: { template_id: "m.new_id" },
                }
            );

            await allocateMap(
                tx,
                "map_step",
                `
                SELECT s.id, nextval(pg_get_serial_sequence('"ActivitiesSequence"', 'id'))::int
                FROM "ActivitiesSequence" s
                WHERE s.account_id = ${sourceId}
                `
            );
            copied.ActivitiesSequence = await insertCopy(tx, "ActivitiesSequence", {
                from: `FROM "ActivitiesSequence" s JOIN map_step m ON m.old_id = s.id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    account_id: `${newAccountId}`,
                    activity_template_id: `COALESCE((SELECT new_id FROM map_template WHERE old_id = s.activity_template_id), s.activity_template_id)`,
                    sequence_container_id: `(SELECT new_id FROM map_sequence WHERE old_id = s.sequence_container_id)`,
                },
            });

            await allocateMap(
                tx,
                "map_reason",
                `
                SELECT s.id, nextval(pg_get_serial_sequence('"DisputeReason"', 'id'))::int
                FROM "DisputeReason" s
                WHERE s.account_id = ${sourceId}
                `
            );
            copied.DisputeReason = await insertCopy(tx, "DisputeReason", {
                from: `FROM "DisputeReason" s JOIN map_reason m ON m.old_id = s.id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    account_id: `${newAccountId}`,
                },
            });
            copied.DisputeReasonLanguage = await insertCopy(
                tx,
                "DisputeReasonLanguage",
                {
                    from: `FROM "DisputeReasonLanguage" s JOIN map_reason m ON m.old_id = s.dispute_reason_id`,
                    where: "true",
                    overrides: { dispute_reason_id: "m.new_id" },
                }
            );

            copied.InternalEmailTemplate = await insertCopy(
                tx,
                "InternalEmailTemplate",
                {
                    from: `FROM "InternalEmailTemplate" s`,
                    where: `s.account_id = ${sourceId}`,
                    overrides: { account_id: `${newAccountId}` },
                }
            );

            await allocateMap(
                tx,
                "map_policy",
                `
                SELECT s.id,
                       nextval(pg_get_serial_sequence('"InsurancePolicy"', 'id'))::int,
                       'POL-' || lpad(row_number() OVER (ORDER BY s.id)::text, 4, '0'),
                       s.policy_number,
                       s.insurer_name
                FROM "InsurancePolicy" s
                WHERE s.account_id = ${sourceId}
                `,
                "new_number text NOT NULL, old_number text, old_insurer text"
            );
            copied.InsurancePolicy = await insertCopy(tx, "InsurancePolicy", {
                from: `FROM "InsurancePolicy" s JOIN map_policy m ON m.old_id = s.id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    account_id: `${newAccountId}`,
                    policy_number: "m.new_number",
                    insurer_name: `'Demo Insurer'`,
                    parent_insurance_policy_id: "NULL",
                    pending_payload: "NULL",
                    pending_created_by: "NULL",
                },
            });
            await relink(tx, "InsurancePolicy", "parent_insurance_policy_id", "map_policy");

            await tx.$executeRawUnsafe(`
                CREATE TEMP TABLE map_polcountry (
                    old_id uuid PRIMARY KEY,
                    new_id uuid NOT NULL UNIQUE
                ) ON COMMIT DROP
            `);
            await tx.$executeRawUnsafe(`
                INSERT INTO map_polcountry (old_id, new_id)
                SELECT s.id, gen_random_uuid()
                FROM "InsurancePolicyCountry" s
                JOIN map_policy m ON m.old_id = s.insurance_policy_id
            `);
            copied.InsurancePolicyCountry = await insertCopy(
                tx,
                "InsurancePolicyCountry",
                {
                    from: `FROM "InsurancePolicyCountry" s JOIN map_polcountry m ON m.old_id = s.id JOIN map_policy p ON p.old_id = s.insurance_policy_id`,
                    where: "true",
                    includeId: true,
                    overrides: {
                        id: "m.new_id",
                        insurance_policy_id: "p.new_id",
                    },
                }
            );

            await allocateMap(
                tx,
                "map_company",
                `
                SELECT s.id,
                       nextval(pg_get_serial_sequence('"Company"', 'id'))::int,
                       s.name,
                       'Demo Company ' || lpad(row_number() OVER (ORDER BY s.id)::text, 4, '0')
                FROM "Company" s
                WHERE s.id IN (
                    SELECT c.company_id FROM "Customer" c
                    WHERE c.account_id = ${sourceId} AND c.company_id IS NOT NULL
                )
                `,
                "old_name text NOT NULL, new_name text NOT NULL"
            );
            copied.Company = await insertCopy(tx, "Company", {
                from: `FROM "Company" s JOIN map_company m ON m.old_id = s.id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    name: "m.new_name",
                },
            });

            await allocateMap(
                tx,
                "map_customer",
                `
                SELECT s.id,
                       nextval(pg_get_serial_sequence('"Customer"', 'id'))::int
                FROM "Customer" s
                WHERE s.account_id = ${sourceId}
                `
            );
            copied.Customer = await insertCopy(tx, "Customer", {
                from: `FROM "Customer" s JOIN map_customer m ON m.old_id = s.id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    account_id: `${newAccountId}`,
                    company_id: `(SELECT new_id FROM map_company WHERE old_id = s.company_id)`,
                    person_id: "NULL",
                    parent_customer_id: "NULL",
                    business_unit_id: `(SELECT new_id FROM map_bu WHERE old_id = s.business_unit_id)`,
                    sequence_container_id: `(SELECT new_id FROM map_sequence WHERE old_id = s.sequence_container_id)`,
                    address_line1: "NULL",
                    address_line2: "NULL",
                    postal_code: "NULL",
                    city: "NULL",
                    phone: "NULL",
                    email: "NULL",
                    generic_text1: "NULL",
                    generic_text2: "NULL",
                    customer_uuid: "gen_random_uuid()",
                },
            });
            await relink(tx, "Customer", "parent_customer_id", "map_customer");

            await allocateMap(
                tx,
                "map_cpolicy",
                `
                SELECT s.id, nextval(pg_get_serial_sequence('"CustomerPolicy"', 'id'))::int
                FROM "CustomerPolicy" s
                JOIN map_customer mc ON mc.old_id = s.customer_id
                `
            );
            copied.CustomerPolicy = await insertCopy(tx, "CustomerPolicy", {
                from: `FROM "CustomerPolicy" s JOIN map_cpolicy m ON m.old_id = s.id JOIN map_customer mc ON mc.old_id = s.customer_id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    customer_id: "mc.new_id",
                    insurance_policy_id: `(SELECT new_id FROM map_policy WHERE old_id = s.insurance_policy_id)`,
                },
            });

            copied.CustomerTopUp = await insertCopy(tx, "CustomerTopUp", {
                from: `FROM "CustomerTopUp" s JOIN map_customer mc ON mc.old_id = s.customer_id`,
                where: "true",
                overrides: {
                    customer_id: "mc.new_id",
                    insurance_policy_id: `(SELECT new_id FROM map_policy WHERE old_id = s.insurance_policy_id)`,
                    notes: "NULL",
                },
            });

            copied.CustomerAggregatedData = await insertCopy(
                tx,
                "CustomerAggregatedData",
                {
                    from: `FROM "CustomerAggregatedData" s JOIN map_customer mc ON mc.old_id = s.customer_id`,
                    where: "true",
                    overrides: { customer_id: "mc.new_id" },
                }
            );

            await allocateMap(
                tx,
                "map_period",
                `
                SELECT s.id,
                       nextval(pg_get_serial_sequence('"CustomerCollectionPeriod"', 'id'))::int
                FROM "CustomerCollectionPeriod" s
                JOIN map_customer mc ON mc.old_id = s.customer_id
                `
            );
            copied.CustomerCollectionPeriod = await insertCopy(
                tx,
                "CustomerCollectionPeriod",
                {
                    from: `FROM "CustomerCollectionPeriod" s JOIN map_period m ON m.old_id = s.id JOIN map_customer mc ON mc.old_id = s.customer_id`,
                    where: "true",
                    includeId: true,
                    overrides: {
                        id: "m.new_id",
                        customer_id: "mc.new_id",
                        // Keep demo idle — do not let cron enqueue next activities.
                        create_next_activity: "false",
                    },
                }
            );

            copied.CustomerCheckpoint = await insertCopy(tx, "CustomerCheckpoint", {
                from: `FROM "CustomerCheckpoint" s JOIN map_customer mc ON mc.old_id = s.customer_id`,
                where: "true",
                overrides: {
                    customer_id: "mc.new_id",
                    account_id: `${newAccountId}`,
                },
            });

            await allocateMap(
                tx,
                "map_named",
                `
                SELECT s.id, nextval(pg_get_serial_sequence('"NamedPolicy"', 'id'))::int
                FROM "NamedPolicy" s
                JOIN map_policy p ON p.old_id = s.insurance_policy_id
                `
            );
            copied.NamedPolicy = await insertCopy(tx, "NamedPolicy", {
                from: `FROM "NamedPolicy" s JOIN map_named m ON m.old_id = s.id JOIN map_policy p ON p.old_id = s.insurance_policy_id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    insurance_policy_id: "p.new_id",
                },
            });

            await allocateMap(
                tx,
                "map_invoice",
                `
                SELECT s.id,
                       nextval(pg_get_serial_sequence('"Invoice"', 'id'))::int
                FROM "Invoice" s
                WHERE s.account_id = ${sourceId}
                `
            );
            copied.Invoice = await insertCopy(tx, "Invoice", {
                from: `FROM "Invoice" s JOIN map_invoice m ON m.old_id = s.id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    account_id: `${newAccountId}`,
                    customer_id: `(SELECT new_id FROM map_customer WHERE old_id = s.customer_id)`,
                    policy_id: `(SELECT new_id FROM map_policy WHERE old_id = s.policy_id)`,
                    credit_for_invoice_id: "NULL",
                    collection_period_id: `(SELECT new_id FROM map_period WHERE old_id = s.collection_period_id)`,
                    generic_text1: "NULL",
                    generic_text2: "NULL",
                    reporting_comment: "NULL",
                },
            });
            await relink(tx, "Invoice", "credit_for_invoice_id", "map_invoice");

            copied.InvoicePayment = await insertCopy(tx, "InvoicePayment", {
                from: `FROM "InvoicePayment" s JOIN map_customer mc ON mc.old_id = s.customer_id`,
                where: `s.account_id = ${sourceId}`,
                overrides: {
                    account_id: `${newAccountId}`,
                    customer_id: "mc.new_id",
                    invoice_id: `(SELECT new_id FROM map_invoice WHERE old_id = s.invoice_id)`,
                },
            });

            await allocateMap(
                tx,
                "map_dispute",
                `
                SELECT s.id,
                       nextval(pg_get_serial_sequence('"CustomerDispute"', 'id'))::int
                FROM "CustomerDispute" s
                JOIN map_customer mc ON mc.old_id = s.customer_id
                `
            );
            copied.CustomerDispute = await insertCopy(tx, "CustomerDispute", {
                from: `FROM "CustomerDispute" s JOIN map_dispute m ON m.old_id = s.id JOIN map_customer mc ON mc.old_id = s.customer_id`,
                where: "true",
                includeId: true,
                overrides: {
                    id: "m.new_id",
                    customer_id: "mc.new_id",
                    dispute_reason_id: `(SELECT new_id FROM map_reason WHERE old_id = s.dispute_reason_id)`,
                    customer_collection_period_id: `(SELECT new_id FROM map_period WHERE old_id = s.customer_collection_period_id)`,
                    customer_comment: "NULL",
                    resolution_comment: "NULL",
                    contact_first_name: "NULL",
                    contact_last_name: "NULL",
                    contact_email: "NULL",
                    contact_mobile: "NULL",
                },
            });
            copied.DisputeInvoice = await insertCopy(tx, "DisputeInvoice", {
                from: `FROM "DisputeInvoice" s JOIN map_dispute md ON md.old_id = s.dispute_id JOIN map_invoice mi ON mi.old_id = s.invoice_id`,
                where: "true",
                overrides: {
                    dispute_id: "md.new_id",
                    invoice_id: "mi.new_id",
                },
            });

            copied.CustomerPolicyTrend = await insertCopy(tx, "CustomerPolicyTrend", {
                from: `FROM "CustomerPolicyTrend" s`,
                where: `s.account_id = ${sourceId}`,
                overrides: {
                    account_id: `${newAccountId}`,
                    customer_id: `(SELECT new_id FROM map_customer WHERE old_id = s.customer_id)`,
                    insurance_policy_id: `(SELECT new_id FROM map_policy WHERE old_id = s.insurance_policy_id)`,
                    customer_policy_id: `(SELECT new_id FROM map_cpolicy WHERE old_id = s.customer_policy_id)`,
                },
            });
            copied.InsurancePolicyTrend = await insertCopy(tx, "InsurancePolicyTrend", {
                from: `FROM "InsurancePolicyTrend" s JOIN map_policy p ON p.old_id = s.insurance_policy_id`,
                where: "true",
                overrides: {
                    account_id: `${newAccountId}`,
                    insurance_policy_id: "p.new_id",
                    policy_number: "p.new_number",
                    insurer_name: `'Demo Insurer'`,
                    parent_insurance_policy_id: `(SELECT new_id FROM map_policy WHERE old_id = s.parent_insurance_policy_id)`,
                },
            });
            copied.InsurancePolicyCountryTrend = await insertCopy(
                tx,
                "InsurancePolicyCountryTrend",
                {
                    from: `FROM "InsurancePolicyCountryTrend" s JOIN map_polcountry c ON c.old_id = s.insurance_policy_country_id JOIN map_policy p ON p.old_id = s.insurance_policy_id`,
                    where: "true",
                    overrides: {
                        account_id: `${newAccountId}`,
                        insurance_policy_id: "p.new_id",
                        insurance_policy_country_id: "c.new_id",
                    },
                }
            );
            copied.NamedPolicyTrend = await insertCopy(tx, "NamedPolicyTrend", {
                from: `FROM "NamedPolicyTrend" s JOIN map_named n ON n.old_id = s.named_policy_id JOIN map_policy p ON p.old_id = s.insurance_policy_id`,
                where: "true",
                overrides: {
                    account_id: `${newAccountId}`,
                    insurance_policy_id: "p.new_id",
                    named_policy_id: "n.new_id",
                },
            });
            copied.CreditDashboardDailySnapshot = 0;
            copied.Report = await insertCopy(tx, "Report", {
                from: `FROM "Report" s`,
                where: `s.account_id = ${sourceId}`,
                overrides: { account_id: `${newAccountId}` },
            });

            await tx.$executeRawUnsafe(`
                CREATE TEMP TABLE scrub (
                    old_text text PRIMARY KEY,
                    new_text text NOT NULL
                ) ON COMMIT DROP
            `);
            await tx.$executeRawUnsafe(`
                INSERT INTO scrub (old_text, new_text)
                SELECT ${sqlString(source.name ?? "")}, ${sqlString(accountName)}
                WHERE char_length(${sqlString(source.name ?? "")}) >= 3
                ON CONFLICT (old_text) DO NOTHING
            `);
            if (source.sub_domain) {
                await tx.$executeRawUnsafe(`
                    INSERT INTO scrub (old_text, new_text)
                    VALUES (${sqlString(source.sub_domain)}, ${sqlString(subDomain)})
                    ON CONFLICT (old_text) DO NOTHING
                `);
            }
            await tx.$executeRawUnsafe(`
                INSERT INTO scrub (old_text, new_text)
                SELECT old_name, MIN(new_name)
                FROM map_company
                WHERE char_length(old_name) >= 3
                  AND position('"' in old_name) = 0
                  AND position('\\' in old_name) = 0
                GROUP BY old_name
                ON CONFLICT (old_text) DO NOTHING
            `);
            await tx.$executeRawUnsafe(`
                INSERT INTO scrub (old_text, new_text)
                SELECT old_number, MIN(new_number)
                FROM map_policy
                WHERE old_number IS NOT NULL AND char_length(old_number) >= 3
                  AND position('"' in old_number) = 0
                GROUP BY old_number
                ON CONFLICT (old_text) DO NOTHING
            `);
            await tx.$executeRawUnsafe(`
                INSERT INTO scrub (old_text, new_text)
                SELECT old_insurer, 'Demo Insurer'
                FROM map_policy
                WHERE old_insurer IS NOT NULL AND char_length(old_insurer) >= 3
                  AND position('"' in old_insurer) = 0
                GROUP BY old_insurer
                ON CONFLICT (old_text) DO NOTHING
            `);

            await tx.$executeRawUnsafe(`
                CREATE TEMP TABLE scrub_targets (
                    table_name text NOT NULL,
                    column_name text NOT NULL,
                    where_sql text NOT NULL,
                    is_json boolean NOT NULL
                ) ON COMMIT DROP
            `);
            const scrubTargets: Array<[string, string, string, boolean]> = [
                ["Report", "report_config", `account_id = ${newAccountId}`, true],
                ["ActivitiesTemplate", "name", `account_id = ${newAccountId}`, false],
                ["SequenceContainer", "name", `account_id = ${newAccountId}`, false],
                ["InternalEmailTemplate", "name", `account_id = ${newAccountId}`, false],
                ["InternalEmailTemplate", "subject", `account_id = ${newAccountId}`, false],
                ["InternalEmailTemplate", "content", `account_id = ${newAccountId}`, false],
                ["DisputeReason", "name", `account_id = ${newAccountId}`, false],
                [
                    "ActivityTemplateLanguage",
                    "email_subject",
                    `template_id IN (SELECT new_id FROM map_template)`,
                    false,
                ],
                [
                    "ActivityTemplateLanguage",
                    "email_content",
                    `template_id IN (SELECT new_id FROM map_template)`,
                    false,
                ],
                [
                    "ActivityTemplateLanguage",
                    "sms_content",
                    `template_id IN (SELECT new_id FROM map_template)`,
                    false,
                ],
                [
                    "ActivityTemplateLanguage",
                    "whatsapp_content",
                    `template_id IN (SELECT new_id FROM map_template)`,
                    false,
                ],
                [
                    "CustomerPolicy",
                    "policy_exclusion_reason",
                    `customer_id IN (SELECT new_id FROM map_customer)`,
                    false,
                ],
                [
                    "CustomerCheckpoint",
                    "payload",
                    `account_id = ${newAccountId}`,
                    true,
                ],
            ];
            for (const [table, column, whereSql, isJson] of scrubTargets) {
                await tx.$executeRawUnsafe(`
                    INSERT INTO scrub_targets (table_name, column_name, where_sql, is_json)
                    VALUES (${sqlString(table)}, ${sqlString(column)}, ${sqlString(whereSql)}, ${isJson})
                `);
            }
            await tx.$executeRawUnsafe(`
                DO $body$
                DECLARE
                    rec record;
                    tgt record;
                    cast_suffix text;
                BEGIN
                    FOR rec IN
                        SELECT old_text, new_text
                        FROM scrub
                        ORDER BY char_length(old_text) DESC
                    LOOP
                        FOR tgt IN SELECT * FROM scrub_targets LOOP
                            cast_suffix := CASE WHEN tgt.is_json THEN '::json' ELSE '' END;
                            EXECUTE format(
                                'UPDATE %I SET %I = (replace(%I::text, $1, $2))%s WHERE %s AND position($1 in COALESCE(%I::text, '''')) > 0',
                                tgt.table_name,
                                tgt.column_name,
                                tgt.column_name,
                                cast_suffix,
                                tgt.where_sql,
                                tgt.column_name
                            )
                            USING rec.old_text, rec.new_text;
                        END LOOP;
                    END LOOP;
                END
                $body$
            `);

            const deltaRows = await tx.$queryRawUnsafe<Array<{ delta: number }>>(`
                SELECT (CURRENT_DATE - COALESCE(MAX(invoice_date), CURRENT_DATE))::int AS delta
                FROM "Invoice"
                WHERE account_id = ${newAccountId}
            `);
            const deltaDays = deltaRows[0]?.delta ?? 0;
            const shiftWhere: Array<[string, string]> = [
                ["Account", `id = ${newAccountId}`],
                ["Invoice", `account_id = ${newAccountId}`],
                ["InvoicePayment", `account_id = ${newAccountId}`],
                ["Customer", `account_id = ${newAccountId}`],
                ["CustomerCollectionPeriod", `id IN (SELECT new_id FROM map_period)`],
                ["CustomerDispute", `id IN (SELECT new_id FROM map_dispute)`],
                ["CustomerPolicy", `id IN (SELECT new_id FROM map_cpolicy)`],
                ["CustomerTopUp", `customer_id IN (SELECT new_id FROM map_customer)`],
                ["CustomerPolicyTrend", `account_id = ${newAccountId}`],
                ["InsurancePolicy", `account_id = ${newAccountId}`],
                ["InsurancePolicyTrend", `account_id = ${newAccountId}`],
                ["InsurancePolicyCountryTrend", `account_id = ${newAccountId}`],
                ["NamedPolicy", `id IN (SELECT new_id FROM map_named)`],
                ["NamedPolicyTrend", `account_id = ${newAccountId}`],
                ["CustomerCheckpoint", `account_id = ${newAccountId}`],
            ];
            for (const [table, whereSql] of shiftWhere) {
                await shiftDates(tx, table, whereSql, deltaDays);
            }

            await tx.$executeRawUnsafe(`
                DELETE FROM "DashboardCache" WHERE account_id = ${newAccountId}
            `);

            const leaked = await tx.$queryRawUnsafe<Array<{ n: number }>>(`
                SELECT COUNT(*)::int AS n
                FROM "Company" c
                JOIN "Customer" cu ON cu.company_id = c.id
                WHERE cu.account_id = ${newAccountId}
                  AND EXISTS (
                    SELECT 1
                    FROM "Customer" src
                    JOIN "Company" sc ON sc.id = src.company_id
                    WHERE src.account_id = ${sourceId}
                      AND sc.name = c.name
                  )
            `);
            if ((leaked[0]?.n ?? 0) > 0) {
                throw new Error("Clone still contains source company names");
            }
            const connectors = await tx.$queryRawUnsafe<Array<{ n: number }>>(`
                SELECT COUNT(*)::int AS n FROM "BillingConnector" WHERE account_id = ${newAccountId}
            `);
            if ((connectors[0]?.n ?? 0) > 0) {
                throw new Error("Clone copied a billing connector");
            }

            return { newAccountId, deltaDays, copied, subDomain };
        },
        { timeout: 900_000, maxWait: 60_000 }
    );

    result.copied.CreditDashboardDailySnapshot = await prisma.$transaction(
        async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15min'`);
            await tx.$executeRawUnsafe(`
                CREATE TEMP TABLE map_policy (old_id int PRIMARY KEY, new_id int NOT NULL) ON COMMIT DROP
            `);
            await tx.$executeRawUnsafe(`
                INSERT INTO map_policy (old_id, new_id)
                SELECT s.id, d.id
                FROM (
                    SELECT id,
                           'POL-' || lpad(row_number() OVER (ORDER BY id)::text, 4, '0') AS policy_number
                    FROM "InsurancePolicy"
                    WHERE account_id = ${sourceId}
                ) s
                JOIN "InsurancePolicy" d
                  ON d.account_id = ${result.newAccountId}
                 AND d.policy_number = s.policy_number
            `);
            await tx.$executeRawUnsafe(`
                CREATE TEMP TABLE map_bu (old_id int PRIMARY KEY, new_id int NOT NULL) ON COMMIT DROP
            `);
            await tx.$executeRawUnsafe(`
                INSERT INTO map_bu (old_id, new_id)
                SELECT s.id, d.id
                FROM (
                    SELECT id, row_number() OVER (ORDER BY id) AS n
                    FROM "BusinessUnit"
                    WHERE account_id = ${sourceId}
                ) s
                JOIN "BusinessUnit" d
                  ON d.account_id = ${result.newAccountId}
                 AND d.name = 'Unit ' || s.n::text
            `);
            return copyCreditDashboardSnapshots(
                tx,
                sourceId,
                result.newAccountId,
                result.deltaDays
            );
        },
        { timeout: 900_000, maxWait: 60_000 }
    );

    console.log(
        JSON.stringify(
            {
                sourceAccountId: sourceId,
                demoAccountId: result.newAccountId,
                name: accountName,
                subDomain: result.subDomain,
                username,
                email,
                isDemo: true,
                dateShiftDays: result.deltaDays,
                copied: result.copied,
            },
            null,
            2
        )
    );
    await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[clone-demo-account] ${message}`);
    process.exit(1);
});
