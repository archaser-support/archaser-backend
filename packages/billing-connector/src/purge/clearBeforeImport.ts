import type { PrismaClient } from "@prisma/client";

/** Entities that can be listed in Start backfill `clear_before_import`. */
export const CLEAR_BEFORE_IMPORT_ENTITIES = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
] as const;

export type ClearBeforeImportEntity =
    (typeof CLEAR_BEFORE_IMPORT_ENTITIES)[number];

export type ClearBeforeImportDeletedCounts = Partial<
    Record<ClearBeforeImportEntity, number>
>;

/** Default delete batch size — cancel is checked between batches. */
export const CLEAR_BEFORE_IMPORT_BATCH_SIZE = 500;

export type ClearBeforeImportProgress = {
    deleted: ClearBeforeImportDeletedCounts;
    currentEntity: ClearBeforeImportEntity | null;
    /** Planned rows across requested entity tables (determinate progress). */
    total?: number;
};

export type ClearBeforeImportResult = {
    deleted: ClearBeforeImportDeletedCounts;
    cancelled: boolean;
};

export interface ClearBeforeImportOptions {
    prisma: PrismaClient;
    accountId: number;
    /** Entities requested for wipe (must also be enabled to actually purge). */
    entities: ClearBeforeImportEntity[];
    /** Enabled connector entities — disabled ones are skipped. */
    enabledEntities: readonly string[];
    /**
     * Optional customer id scope (slice 02). When omitted, purge is account-wide.
     * Payment purge ignores customer amount recalculation.
     */
    customerId?: number | null;
    /** Rows per delete batch (default {@link CLEAR_BEFORE_IMPORT_BATCH_SIZE}). */
    batchSize?: number;
    /** Cooperative cancel — checked between delete batches / entity steps. */
    shouldCancel?: () => boolean;
    /** Live deleted counts while purge runs (Start backfill progress). */
    onProgress?: (progress: ClearBeforeImportProgress) => void;
}

function isClearBeforeImportEntity(
    value: string
): value is ClearBeforeImportEntity {
    return (CLEAR_BEFORE_IMPORT_ENTITIES as readonly string[]).includes(value);
}

/**
 * Normalize Start backfill `clear_before_import` body values.
 * Unknown strings are dropped; duplicates collapse.
 */
export function parseClearBeforeImport(
    raw: unknown
): ClearBeforeImportEntity[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set<ClearBeforeImportEntity>();
    const out: ClearBeforeImportEntity[] = [];
    for (const item of raw) {
        if (typeof item !== "string" || !isClearBeforeImportEntity(item)) {
            continue;
        }
        if (seen.has(item)) {
            continue;
        }
        seen.add(item);
        out.push(item);
    }
    return out;
}

/**
 * Entities that are both requested for clear and currently enabled.
 */
export function resolveClearBeforeImportTargets(params: {
    requested: readonly ClearBeforeImportEntity[];
    enabledEntities: readonly string[];
}): ClearBeforeImportEntity[] {
    const enabled = new Set(params.enabledEntities);
    return params.requested.filter((entity) => enabled.has(entity));
}

/**
 * Normalize optional Start backfill `customer_id` body/query value.
 * Empty / non-positive / non-numeric → null (account-wide).
 */
export function parseCustomerIdForClearBeforeImport(
    raw: unknown
): number | null {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        return Math.trunc(raw);
    }
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!/^\d+$/.test(trimmed)) {
            return null;
        }
        const id = Number.parseInt(trimmed, 10);
        return Number.isFinite(id) && id > 0 ? id : null;
    }
    return null;
}

/**
 * @deprecated Use {@link parseCustomerIdForClearBeforeImport}. Kept for older callers.
 */
export function parseCustomerNumberForClearBeforeImport(
    raw: unknown
): string | null {
    const id = parseCustomerIdForClearBeforeImport(raw);
    return id != null ? String(id) : null;
}

function customerDisplayName(customer: {
    customer_number?: string | null;
    Company?: { name?: string | null } | null;
    Person?: {
        first_name?: string | null;
        last_name?: string | null;
    } | null;
}): string {
    const company = customer.Company?.name?.trim();
    if (company) {
        return company;
    }
    const person = [customer.Person?.first_name, customer.Person?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
    return person || customer.customer_number?.trim() || "";
}

/**
 * Look up a customer on the account by Archaser `customer_id`.
 */
export async function resolveAccountCustomerById(params: {
    prisma: PrismaClient;
    accountId: number;
    customerId: number;
}): Promise<{ id: number; customer_number: string; name: string } | null> {
    const customerId = parseCustomerIdForClearBeforeImport(params.customerId);
    if (customerId == null) {
        return null;
    }
    const row = await params.prisma.customer.findFirst({
        where: {
            account_id: params.accountId,
            id: customerId,
        },
        select: {
            id: true,
            customer_number: true,
            Company: { select: { name: true } },
            Person: { select: { first_name: true, last_name: true } },
        },
    });
    if (!row?.customer_number) {
        return null;
    }
    return {
        id: row.id,
        customer_number: row.customer_number,
        name: customerDisplayName(row),
    };
}

/** Typeahead search for customers on an account (Start backfill customer scope). */
export async function searchAccountCustomers(params: {
    prisma: PrismaClient;
    accountId: number;
    q?: string;
    take?: number;
}): Promise<
    Array<{ id: number; customer_number: string; name: string; type: string }>
> {
    const q = (params.q ?? "").trim();
    const take = Math.min(Math.max(params.take ?? 50, 1), 50);
    const andClause: Record<string, unknown>[] = [
        { account_id: params.accountId },
    ];
    if (q) {
        const orClause: Record<string, unknown>[] = [
            {
                customer_number: {
                    contains: q,
                    mode: "insensitive",
                },
            },
            {
                Person: {
                    OR: [
                        {
                            first_name: {
                                contains: q,
                                mode: "insensitive",
                            },
                        },
                        {
                            last_name: {
                                contains: q,
                                mode: "insensitive",
                            },
                        },
                        {
                            full_name: {
                                contains: q,
                                mode: "insensitive",
                            },
                        },
                    ],
                },
            },
            {
                Company: {
                    name: { contains: q, mode: "insensitive" },
                },
            },
        ];
        if (/^\d+$/.test(q)) {
            const id = Number.parseInt(q, 10);
            if (Number.isFinite(id) && id > 0) {
                orClause.unshift({ id });
            }
        }
        andClause.push({ OR: orClause });
    }

    const rows = await params.prisma.customer.findMany({
        where: { AND: andClause },
        select: {
            id: true,
            customer_number: true,
            type: true,
            Company: { select: { name: true } },
            Person: {
                select: {
                    first_name: true,
                    last_name: true,
                    full_name: true,
                },
            },
        },
        orderBy: [{ customer_number: "asc" }, { id: "asc" }],
        take,
    });

    return rows
        .filter((row) => Boolean(row.customer_number))
        .map((row) => ({
            id: row.id,
            customer_number: row.customer_number as string,
            name:
                row.type === "Person"
                    ? row.Person?.full_name?.trim() ||
                      [row.Person?.first_name, row.Person?.last_name]
                          .filter(Boolean)
                          .join(" ")
                          .trim() ||
                      customerDisplayName(row)
                    : customerDisplayName(row),
            type: row.type,
        }));
}

/**
 * @deprecated Use {@link resolveAccountCustomerById}.
 */
export async function resolveAccountCustomerByNumber(params: {
    prisma: PrismaClient;
    accountId: number;
    customerNumber: string;
}): Promise<{ id: number; customer_number: string } | null> {
    const customerId = parseCustomerIdForClearBeforeImport(params.customerNumber);
    if (customerId == null) {
        return null;
    }
    return resolveAccountCustomerById({
        prisma: params.prisma,
        accountId: params.accountId,
        customerId,
    });
}

function accountCustomerScope(params: {
    accountId: number;
    customerId?: number | null;
}): { account_id: number; customer_id?: number } {
    if (params.customerId != null) {
        return {
            account_id: params.accountId,
            customer_id: params.customerId,
        };
    }
    return { account_id: params.accountId };
}

/** Contact has no account_id — scope via customer_id or Customer.account_id. */
function contactScopeWhere(params: {
    accountId: number;
    customerId?: number | null;
}): { customer_id: number } | { Customer: { account_id: number } } {
    if (params.customerId != null) {
        return { customer_id: params.customerId };
    }
    return { Customer: { account_id: params.accountId } };
}

/** Tables that only have customer_id (no account_id). */
function customerOwnedWhere(params: {
    accountId: number;
    customerId?: number | null;
}): { customer_id: number } | { Customer: { account_id: number } } {
    return contactScopeWhere(params);
}

/**
 * Delete matching rows in SQL batches (DELETE … WHERE id IN (SELECT … LIMIT)).
 * Avoids loading every id into Node and deleting one row at a time.
 */
async function deleteRowsInBatches(params: {
    prisma: PrismaClient;
    /** Quoted PostgreSQL table name, e.g. `"InvoicePayment"`. */
    tableSql: string;
    /** SQL WHERE clause without the leading WHERE (uses alias `t`). */
    whereSql: string;
    /** Values bound into whereSql ($1, $2, …). */
    whereParams: unknown[];
    batchSize: number;
    shouldCancel?: () => boolean;
    onBatchDeleted?: (deletedInBatch: number, totalDeleted: number) => void;
}): Promise<{ count: number; cancelled: boolean }> {
    let count = 0;
    const limitPlaceholder = `$${params.whereParams.length + 1}`;
    const sql = `
        WITH doomed AS (
            SELECT t.id
            FROM ${params.tableSql} t
            WHERE ${params.whereSql}
            LIMIT ${limitPlaceholder}
        )
        DELETE FROM ${params.tableSql} d
        USING doomed
        WHERE d.id = doomed.id
    `;
    while (true) {
        if (params.shouldCancel?.()) {
            return { count, cancelled: true };
        }
        const deleted = await params.prisma.$executeRawUnsafe(
            sql,
            ...params.whereParams,
            params.batchSize
        );
        const n = typeof deleted === "number" ? deleted : Number(deleted);
        if (!Number.isFinite(n) || n <= 0) {
            return { count, cancelled: false };
        }
        count += n;
        params.onBatchDeleted?.(n, count);
        if (params.shouldCancel?.()) {
            return { count, cancelled: true };
        }
        if (n < params.batchSize) {
            return { count, cancelled: false };
        }
    }
}

async function countRowsRaw(params: {
    prisma: PrismaClient;
    tableSql: string;
    whereSql: string;
    whereParams: unknown[];
}): Promise<number> {
    const rows = await params.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*)::bigint AS count FROM ${params.tableSql} t WHERE ${params.whereSql}`,
        ...params.whereParams
    );
    return Number(rows[0]?.count ?? 0);
}

function accountScopeSql(params: {
    accountId: number;
    customerId?: number | null;
}): { whereSql: string; whereParams: unknown[] } {
    if (params.customerId != null) {
        return {
            whereSql: `t.account_id = $1 AND t.customer_id = $2`,
            whereParams: [params.accountId, params.customerId],
        };
    }
    return {
        whereSql: `t.account_id = $1`,
        whereParams: [params.accountId],
    };
}

function customerOwnedScopeSql(params: {
    accountId: number;
    customerId?: number | null;
}): { whereSql: string; whereParams: unknown[] } {
    if (params.customerId != null) {
        return {
            whereSql: `t.customer_id = $1`,
            whereParams: [params.customerId],
        };
    }
    return {
        whereSql: `t.customer_id IN (SELECT c.id FROM "Customer" c WHERE c.account_id = $1)`,
        whereParams: [params.accountId],
    };
}

/**
 * Invoice purge: nullify NoAction blockers, then delete invoices in batches.
 * `DisputeInvoice` / `InvoicePayment` cascade from Invoice.
 */
async function purgeInvoices(params: {
    prisma: PrismaClient;
    accountId: number;
    customerId?: number | null;
    batchSize: number;
    shouldCancel?: () => boolean;
    onDeleted?: (count: number) => void;
}): Promise<{ count: number; cancelled: boolean }> {
    const scope = accountCustomerScope(params);
    const scopeSql = accountScopeSql(params);
    await params.prisma.activity.updateMany({
        where: {
            ...scope,
            invoice_id: { not: null },
        },
        data: { invoice_id: null },
    });
    await params.prisma.invoice.updateMany({
        where: {
            ...scope,
            credit_for_invoice_id: { not: null },
        },
        data: { credit_for_invoice_id: null },
    });
    return deleteRowsInBatches({
        prisma: params.prisma,
        tableSql: `"Invoice"`,
        whereSql: scopeSql.whereSql,
        whereParams: scopeSql.whereParams,
        batchSize: params.batchSize,
        shouldCancel: params.shouldCancel,
        onBatchDeleted: (_batch, total) => params.onDeleted?.(total),
    });
}

/**
 * Contact purge: nullify NoAction blockers, then delete contacts in batches.
 */
async function purgeContacts(params: {
    prisma: PrismaClient;
    accountId: number;
    customerId?: number | null;
    batchSize: number;
    shouldCancel?: () => boolean;
    onDeleted?: (count: number) => void;
}): Promise<{ count: number; cancelled: boolean }> {
    const contactScope = contactScopeWhere(params);
    const ownedSql = customerOwnedScopeSql(params);
    await params.prisma.activity.updateMany({
        where: {
            account_id: params.accountId,
            contact_id: { not: null },
            Contact: contactScope,
        },
        data: { contact_id: null },
    });
    await params.prisma.contact.updateMany({
        where: {
            ...contactScope,
            fallback_contact_id: { not: null },
        },
        data: { fallback_contact_id: null },
    });
    await params.prisma.communicationLearningData.updateMany({
        where: {
            contact_id: { not: null },
            Contact: contactScope,
        },
        data: { contact_id: null },
    });
    return deleteRowsInBatches({
        prisma: params.prisma,
        tableSql: `"Contact"`,
        whereSql: ownedSql.whereSql,
        whereParams: ownedSql.whereParams,
        batchSize: params.batchSize,
        shouldCancel: params.shouldCancel,
        onBatchDeleted: (_batch, total) => params.onDeleted?.(total),
    });
}

async function purgePayments(params: {
    prisma: PrismaClient;
    accountId: number;
    customerId?: number | null;
    batchSize: number;
    shouldCancel?: () => boolean;
    onDeleted?: (count: number) => void;
}): Promise<{ count: number; cancelled: boolean }> {
    const scopeSql = accountScopeSql(params);
    return deleteRowsInBatches({
        prisma: params.prisma,
        tableSql: `"InvoicePayment"`,
        whereSql: scopeSql.whereSql,
        whereParams: scopeSql.whereParams,
        batchSize: params.batchSize,
        shouldCancel: params.shouldCancel,
        onBatchDeleted: (_batch, total) => params.onDeleted?.(total),
    });
}

/**
 * Customer purge: checkpoint-aligned child-before-parent subtree, then customer row(s).
 * Does not recalculate customer amounts. Large child tables delete in batches.
 */
async function purgeCustomers(params: {
    prisma: PrismaClient;
    accountId: number;
    customerId?: number | null;
    batchSize: number;
    shouldCancel?: () => boolean;
    onDeleted?: (count: number) => void;
}): Promise<{ count: number; cancelled: boolean }> {
    const owned = customerOwnedWhere(params);
    const accountScope = accountCustomerScope(params);
    const accountSql = accountScopeSql(params);
    const ownedSql = customerOwnedScopeSql(params);
    const customerRowWhere =
        params.customerId != null
            ? { id: params.customerId, account_id: params.accountId }
            : { account_id: params.accountId };
    const customerSql =
        params.customerId != null
            ? {
                  whereSql: `t.id = $1 AND t.account_id = $2`,
                  whereParams: [params.customerId, params.accountId] as unknown[],
              }
            : {
                  whereSql: `t.account_id = $1`,
                  whereParams: [params.accountId] as unknown[],
              };

    const cancelCheck = () => Boolean(params.shouldCancel?.());

    // Reverse of customer-checkpoint SNAPSHOT_TABLES insert order.
    if (cancelCheck()) {
        return { count: 0, cancelled: true };
    }
    await params.prisma.customerTopUp.deleteMany({ where: owned });
    if (cancelCheck()) {
        return { count: 0, cancelled: true };
    }
    await params.prisma.customerPolicy.deleteMany({ where: owned });
    if (cancelCheck()) {
        return { count: 0, cancelled: true };
    }
    await params.prisma.customerAggregatedData.deleteMany({ where: owned });
    if (cancelCheck()) {
        return { count: 0, cancelled: true };
    }

    // DisputeInvoice → CustomerDispute (batched via dispute ids in scope).
    await deleteRowsInBatches({
        prisma: params.prisma,
        tableSql: `"DisputeInvoice"`,
        whereSql: `t.dispute_id IN (SELECT d.id FROM "CustomerDispute" d WHERE ${
            params.customerId != null
                ? "d.customer_id = $1"
                : 'd.customer_id IN (SELECT c.id FROM "Customer" c WHERE c.account_id = $1)'
        })`,
        whereParams:
            params.customerId != null
                ? [params.customerId]
                : [params.accountId],
        batchSize: params.batchSize,
        shouldCancel: params.shouldCancel,
    });
    if (cancelCheck()) {
        return { count: 0, cancelled: true };
    }
    await params.prisma.customerDispute.deleteMany({ where: owned });
    if (cancelCheck()) {
        return { count: 0, cancelled: true };
    }

    await deleteRowsInBatches({
        prisma: params.prisma,
        tableSql: `"ActivityContact"`,
        whereSql: `t.activity_id IN (SELECT a.id FROM "Activity" a WHERE ${accountSql.whereSql.replace(/t\./g, "a.")})`,
        whereParams: accountSql.whereParams,
        batchSize: params.batchSize,
        shouldCancel: params.shouldCancel,
    });
    if (cancelCheck()) {
        return { count: 0, cancelled: true };
    }
    await deleteRowsInBatches({
        prisma: params.prisma,
        tableSql: `"Activity"`,
        whereSql: accountSql.whereSql,
        whereParams: accountSql.whereParams,
        batchSize: params.batchSize,
        shouldCancel: params.shouldCancel,
    });
    if (cancelCheck()) {
        return { count: 0, cancelled: true };
    }

    const payments = await deleteRowsInBatches({
        prisma: params.prisma,
        tableSql: `"InvoicePayment"`,
        whereSql: accountSql.whereSql,
        whereParams: accountSql.whereParams,
        batchSize: params.batchSize,
        shouldCancel: params.shouldCancel,
    });
    if (payments.cancelled) {
        return { count: 0, cancelled: true };
    }

    await params.prisma.invoice.updateMany({
        where: {
            ...accountScope,
            credit_for_invoice_id: { not: null },
        },
        data: { credit_for_invoice_id: null },
    });

    const invoices = await deleteRowsInBatches({
        prisma: params.prisma,
        tableSql: `"Invoice"`,
        whereSql: accountSql.whereSql,
        whereParams: accountSql.whereParams,
        batchSize: params.batchSize,
        shouldCancel: params.shouldCancel,
    });
    if (invoices.cancelled) {
        return { count: 0, cancelled: true };
    }

    if (cancelCheck()) {
        return { count: 0, cancelled: true };
    }
    await params.prisma.customerCollectionPeriod.deleteMany({ where: owned });
    if (cancelCheck()) {
        return { count: 0, cancelled: true };
    }
    await params.prisma.customerBanks.deleteMany({ where: owned });
    await params.prisma.contact.updateMany({
        where: {
            ...owned,
            fallback_contact_id: { not: null },
        },
        data: { fallback_contact_id: null },
    });

    const contacts = await deleteRowsInBatches({
        prisma: params.prisma,
        tableSql: `"Contact"`,
        whereSql: ownedSql.whereSql,
        whereParams: ownedSql.whereParams,
        batchSize: params.batchSize,
        shouldCancel: params.shouldCancel,
    });
    if (contacts.cancelled) {
        return { count: 0, cancelled: true };
    }

    await params.prisma.customer.updateMany({
        where: customerRowWhere,
        data: { parent_customer_id: null },
    });

    return deleteRowsInBatches({
        prisma: params.prisma,
        tableSql: `"Customer"`,
        whereSql: customerSql.whereSql,
        whereParams: customerSql.whereParams,
        batchSize: params.batchSize,
        shouldCancel: params.shouldCancel,
        onBatchDeleted: (_batch, total) => params.onDeleted?.(total),
    });
}

/**
 * Account-scoped purge of selected enabled entities before Start backfill import.
 * Commits deletes immediately (no undo). Does not recalculate customer amounts.
 *
 * Fixed child-before-parent order across requested entities:
 * Invoice → Contact → Payment → Customer.
 * Payment always runs when requested (even if Invoice cascade already cleared rows).
 *
 * Deletes run in batches so Stop can finish the current batch and halt before import.
 */
export async function clearBeforeImport(
    options: ClearBeforeImportOptions
): Promise<ClearBeforeImportResult> {
    const targets = resolveClearBeforeImportTargets({
        requested: options.entities,
        enabledEntities: options.enabledEntities,
    });
    const deleted: ClearBeforeImportDeletedCounts = {};
    const batchSize =
        options.batchSize != null && options.batchSize > 0
            ? options.batchSize
            : CLEAR_BEFORE_IMPORT_BATCH_SIZE;
    const scope = {
        accountId: options.accountId,
        customerId: options.customerId,
        batchSize,
        shouldCancel: options.shouldCancel,
    };

    const accountSql = accountScopeSql({
        accountId: options.accountId,
        customerId: options.customerId,
    });
    const ownedSql = customerOwnedScopeSql({
        accountId: options.accountId,
        customerId: options.customerId,
    });
    const customerSql =
        options.customerId != null
            ? {
                  whereSql: `t.id = $1 AND t.account_id = $2`,
                  whereParams: [
                      options.customerId,
                      options.accountId,
                  ] as unknown[],
              }
            : {
                  whereSql: `t.account_id = $1`,
                  whereParams: [options.accountId] as unknown[],
              };

    let plannedTotal = 0;
    if (targets.includes("Invoice")) {
        plannedTotal += await countRowsRaw({
            prisma: options.prisma,
            tableSql: `"Invoice"`,
            whereSql: accountSql.whereSql,
            whereParams: accountSql.whereParams,
        });
    }
    if (targets.includes("Contact")) {
        plannedTotal += await countRowsRaw({
            prisma: options.prisma,
            tableSql: `"Contact"`,
            whereSql: ownedSql.whereSql,
            whereParams: ownedSql.whereParams,
        });
    }
    if (targets.includes("Payment")) {
        plannedTotal += await countRowsRaw({
            prisma: options.prisma,
            tableSql: `"InvoicePayment"`,
            whereSql: accountSql.whereSql,
            whereParams: accountSql.whereParams,
        });
    }
    if (targets.includes("Customer")) {
        plannedTotal += await countRowsRaw({
            prisma: options.prisma,
            tableSql: `"Customer"`,
            whereSql: customerSql.whereSql,
            whereParams: customerSql.whereParams,
        });
    }

    const emit = (currentEntity: ClearBeforeImportEntity | null) => {
        options.onProgress?.({
            deleted: { ...deleted },
            currentEntity,
            total: plannedTotal,
        });
    };

    emit(null);

    const runEntity = async (
        entity: ClearBeforeImportEntity,
        purge: () => Promise<{ count: number; cancelled: boolean }>
    ): Promise<boolean> => {
        if (options.shouldCancel?.()) {
            return true;
        }
        emit(entity);
        const result = await purge();
        deleted[entity] = result.count;
        emit(entity);
        return result.cancelled;
    };

    if (targets.includes("Invoice")) {
        const cancelled = await runEntity("Invoice", () =>
            purgeInvoices({
                prisma: options.prisma,
                ...scope,
                onDeleted: (count) => {
                    deleted.Invoice = count;
                    emit("Invoice");
                },
            })
        );
        if (cancelled) {
            return { deleted, cancelled: true };
        }
    }

    if (targets.includes("Contact")) {
        const cancelled = await runEntity("Contact", () =>
            purgeContacts({
                prisma: options.prisma,
                ...scope,
                onDeleted: (count) => {
                    deleted.Contact = count;
                    emit("Contact");
                },
            })
        );
        if (cancelled) {
            return { deleted, cancelled: true };
        }
    }

    if (targets.includes("Payment")) {
        const cancelled = await runEntity("Payment", () =>
            purgePayments({
                prisma: options.prisma,
                ...scope,
                onDeleted: (count) => {
                    deleted.Payment = count;
                    emit("Payment");
                },
            })
        );
        if (cancelled) {
            return { deleted, cancelled: true };
        }
    }

    if (targets.includes("Customer")) {
        const cancelled = await runEntity("Customer", () =>
            purgeCustomers({
                prisma: options.prisma,
                ...scope,
                onDeleted: (count) => {
                    deleted.Customer = count;
                    emit("Customer");
                },
            })
        );
        if (cancelled) {
            return { deleted, cancelled: true };
        }
    }

    emit(null);
    return { deleted, cancelled: false };
}
