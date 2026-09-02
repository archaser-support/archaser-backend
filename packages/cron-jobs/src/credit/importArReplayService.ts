/**
 * Chronological AR replay — Nest port of the legacy import AR replay module.
 * Stamps `limit_assessed_amount` in invoice_open / payment_apply date order so
 * capacity-gap sync does not skip null assessments.
 *
 * Does not overwrite `outstanding_debt` / `customer_outstanding_debt` — those
 * stay owned by invoice import and payment recalc (credits keep negative nets).
 */
import {
    linkDeferredPaymentsAndRecalcBatch,
    resolveInvoicePaidRecalcOptions,
} from "@archaser/billing-connector";
import {
    computeInvoiceCapacityGapContribution,
    computeLimitAssessedAmountForNewOpenInvoice,
    creditInsurancePrisma as boundPrisma,
    isInvoiceInMepBreachScope,
    parseImportDateToLocalCalendarDate,
    resolveTopUpTotalsForAsOfDates,
    stampInvoicesInsuranceFieldsAsOf,
} from "@archaser/credit-insurance-domain";
import { Prisma, type PrismaClient } from "@prisma/client";

export type ReplayEventType = "invoice_open" | "payment_apply";

export type ReplayInvoiceInput = {
    invoiceNumber: string;
    invoiceDate: Date;
    netAmount: number;
    customerNetAmount: number;
    /** Existing DB id when replaying persisted invoices */
    invoiceId?: number;
};

export type ReplayPaymentInput = {
    id: number;
    invoiceNumber: string;
    paymentDate: Date;
    amount: number;
    customerAmount: number;
    invoiceId?: number | null;
};

export type ReplayEvent =
    | {
          type: "invoice_open";
          date: Date;
          payload: ReplayInvoiceInput;
      }
    | {
          type: "payment_apply";
          date: Date;
          payload: ReplayPaymentInput;
      };

export type ReplaySimulationInvoice = {
    invoiceNumber: string;
    invoiceId?: number;
    netAmount: number;
    customerNetAmount: number;
    outstanding: number;
    customerOutstanding: number;
    limitAssessedAmount: number | null;
};

export type ReplaySimulationConfig = {
    approvedLimit: number;
    topUpTotal?: number;
};

export type ReplaySimulationSummary = {
    eventsApplied: number;
    paymentsLinked: number;
    deferredRemaining: number;
};

export type ReplayCustomerSummary = ReplaySimulationSummary & {
    customerId: number;
};

export type ReplayBatchSummary = {
    customersAffected: number;
    eventsApplied: number;
    paymentsLinked: number;
    deferredRemaining: number;
    perCustomer: ReplayCustomerSummary[];
};

function calendarDayKey(date: Date): number {
    const normalized = parseImportDateToLocalCalendarDate(date);
    if (!normalized) {
        return date.getTime();
    }
    return (
        normalized.getFullYear() * 10000 +
        (normalized.getMonth() + 1) * 100 +
        normalized.getDate()
    );
}

function utcDayKey(date: Date): number {
    return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    );
}

/** Same-day tie-break: invoice_open before payment_apply. */
export function compareReplayEvents(a: ReplayEvent, b: ReplayEvent): number {
    const dayCmp = calendarDayKey(a.date) - calendarDayKey(b.date);
    if (dayCmp !== 0) {
        return dayCmp;
    }
    if (a.type === b.type) {
        return 0;
    }
    return a.type === "invoice_open" ? -1 : 1;
}

export function sortReplayEvents(events: ReplayEvent[]): ReplayEvent[] {
    return [...events].sort(compareReplayEvents);
}

export function buildReplayEvents(
    invoices: ReplayInvoiceInput[],
    payments: ReplayPaymentInput[]
): ReplayEvent[] {
    const events: ReplayEvent[] = [
        ...invoices.map(
            (invoice): ReplayEvent => ({
                type: "invoice_open",
                date: invoice.invoiceDate,
                payload: invoice,
            })
        ),
        ...payments.map(
            (payment): ReplayEvent => ({
                type: "payment_apply",
                date: payment.paymentDate,
                payload: payment,
            })
        ),
    ];
    return sortReplayEvents(events);
}

function sumOpenAr(invoices: ReplaySimulationInvoice[]): number {
    return invoices.reduce((sum, inv) => sum + Math.max(0, inv.outstanding), 0);
}

function gapForInvoice(inv: ReplaySimulationInvoice): number {
    if (inv.limitAssessedAmount == null) {
        return 0;
    }
    return computeInvoiceCapacityGapContribution({
        outstandingLeft: inv.outstanding,
        limitAssessedAmount: inv.limitAssessedAmount,
    });
}

/**
 * Pure in-memory chronological replay for capacity-gap timeline rules.
 * Stamps limit_assessed_amount at invoice_open using open AR with only
 * payments applied on earlier timeline events (same-day payments apply after
 * invoice_open due to tie-break).
 */
export function simulateCustomerArReplay(
    config: ReplaySimulationConfig,
    invoices: ReplayInvoiceInput[],
    payments: ReplayPaymentInput[]
): {
    summary: ReplaySimulationSummary;
    invoices: ReplaySimulationInvoice[];
} {
    const events = buildReplayEvents(invoices, payments);
    const invoiceState = new Map<string, ReplaySimulationInvoice>();
    const linkedPaymentIds = new Set<number>();
    let paymentsLinked = 0;

    for (const event of events) {
        if (event.type === "invoice_open") {
            const payload = event.payload;
            const openArBefore = sumOpenAr(Array.from(invoiceState.values()));
            // Limit assessment ignores credit face value; sim outstanding stays signed.
            const assessedOutstanding = Math.max(0, payload.netAmount);
            const limitAssessedAmount =
                computeLimitAssessedAmountForNewOpenInvoice({
                    approvedLimit: config.approvedLimit,
                    topUpTotal: config.topUpTotal ?? 0,
                    openArOnPolicyBeforeInvoice: openArBefore,
                    newInvoiceOutstanding: assessedOutstanding,
                });

            invoiceState.set(payload.invoiceNumber, {
                invoiceNumber: payload.invoiceNumber,
                invoiceId: payload.invoiceId,
                netAmount: payload.netAmount,
                customerNetAmount: payload.customerNetAmount,
                outstanding: payload.netAmount,
                customerOutstanding: payload.customerNetAmount,
                limitAssessedAmount,
            });
            continue;
        }

        const payment = event.payload;
        const invoice = invoiceState.get(payment.invoiceNumber);
        if (!invoice) {
            continue;
        }

        invoice.outstanding = Math.max(0, invoice.outstanding - payment.amount);
        invoice.customerOutstanding = Math.max(
            0,
            invoice.customerOutstanding - payment.customerAmount
        );
        linkedPaymentIds.add(payment.id);
        paymentsLinked += 1;
    }

    const deferredRemaining = payments.filter(
        (p) => !linkedPaymentIds.has(p.id)
    ).length;

    return {
        summary: {
            eventsApplied: events.length,
            paymentsLinked,
            deferredRemaining,
        },
        invoices: Array.from(invoiceState.values()),
    };
}

export function getInvoiceGap(inv: ReplaySimulationInvoice): number {
    return gapForInvoice(inv);
}

export type ReplayCustomerArImportParams = {
    customerId: number;
    accountId: number;
    invoices?: ReplayInvoiceInput[];
    payments?: ReplayPaymentInput[];
    approvedLimit?: number;
    approvedLimitCurrency?: string | null;
    /** Overrides the per-invoice-date top-up resolution when supplied. */
    topUpTotal?: number;
    dbClient?: PrismaClient;
    /** Event-level progress; a single customer can carry thousands of events. */
    onProgress?: (progress: { processed: number; total: number }) => void;
    /**
     * When true (default), still link payments with `invoice_id = null`.
     * Already-linked payments only update the in-memory open-AR timeline.
     */
    linkDeferredPayments?: boolean;
    /**
     * When true, stamp insurance CTV fields after assessed amounts (batched).
     * Default false: post-ingest capacity gap only needs assessed stamps + live
     * refresh; per-invoice CTV stamping dominated runtime at Helam scale.
     */
    stampInsuranceFields?: boolean;
    /**
     * When set, seed open AR from pre-cutover invoices and replay only events on
     * or after this date (inclusive). Stamps only apply to in-scope invoices.
     */
    mepBreachStartDate?: Date | null;
};

const ASSESSED_BULK_CHUNK = 500;

function utcDayStart(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

/** Sum positive outstanding on invoices issued before the MEP cutover. */
async function seedOpenArBeforeMepCutover(
    db: PrismaClient,
    customerId: number,
    mepBreachStartDate: Date
): Promise<number> {
    const cutover = utcDayStart(mepBreachStartDate);
    const rows = await db.invoice.findMany({
        where: {
            customer_id: customerId,
            invoice_date: { lt: cutover },
            OR: [{ outstanding_debt: { gt: 0 } }, { net_amount: { gt: 0 } }],
        },
        select: { outstanding_debt: true, net_amount: true },
    });
    let total = 0;
    for (const row of rows) {
        const outstanding =
            row.outstanding_debt != null && row.outstanding_debt > 0
                ? row.outstanding_debt
                : Math.max(0, row.net_amount ?? 0);
        total += outstanding;
    }
    return total;
}

function filterReplayInputsForMepCutover(params: {
    invoiceInputs: ReplayInvoiceInput[];
    paymentInputs: ReplayPaymentInput[];
    mepBreachStartDate: Date;
}): {
    invoiceInputs: ReplayInvoiceInput[];
    paymentInputs: ReplayPaymentInput[];
} {
    const cutoverMs = utcDayStart(params.mepBreachStartDate).getTime();
    const invoiceInputs = params.invoiceInputs.filter((inv) => {
        const day = parseImportDateToLocalCalendarDate(inv.invoiceDate);
        return day != null && day.getTime() >= cutoverMs;
    });
    const postCutoverNumbers = new Set(
        invoiceInputs.map((inv) => inv.invoiceNumber)
    );
    const postCutoverIds = new Set(
        invoiceInputs
            .map((inv) => inv.invoiceId)
            .filter((id): id is number => id != null)
    );
    const paymentInputs = params.paymentInputs.filter((payment) => {
        const day = parseImportDateToLocalCalendarDate(payment.paymentDate);
        if (day != null && day.getTime() >= cutoverMs) {
            return true;
        }
        if (
            payment.invoiceId != null &&
            postCutoverIds.has(payment.invoiceId)
        ) {
            return true;
        }
        return postCutoverNumbers.has(payment.invoiceNumber);
    });
    return { invoiceInputs, paymentInputs };
}

type AssessedStamp = {
    invoiceId: number;
    invoiceDate: Date;
    limitAssessedAmount: number;
};

/**
 * Persist distinct assessed amounts in chunks via UPDATE … FROM (VALUES …).
 */
async function bulkWriteLimitAssessedAmounts(
    db: PrismaClient,
    stamps: AssessedStamp[],
    limitCurrency: string | null,
    assessedAt: Date
): Promise<void> {
    if (stamps.length === 0) {
        return;
    }
    for (let i = 0; i < stamps.length; i += ASSESSED_BULK_CHUNK) {
        const chunk = stamps.slice(i, i + ASSESSED_BULK_CHUNK);
        const ids = chunk.map((row) => row.invoiceId);
        const amounts = chunk.map((row) => row.limitAssessedAmount);
        await db.$executeRaw`
            UPDATE "Invoice" AS inv
            SET
                limit_assessed_amount = data.amount,
                limit_assessed_currency = ${limitCurrency},
                limit_assessed_at = ${assessedAt}
            FROM (
                SELECT
                    UNNEST(${ids}::int[]) AS id,
                    UNNEST(${amounts}::float8[]) AS amount
            ) AS data
            WHERE inv.id = data.id
        `;
    }
}

/**
 * Chronological AR replay for one customer.
 *
 * Computes `limit_assessed_amount` entirely in memory (open-AR timeline), then
 * bulk-writes stamps. Deferred payments (`invoice_id` null) are linked afterward;
 * already-linked payments only affect the in-memory timeline — no per-event
 * forceRecalc. Does not rewrite outstanding columns.
 */
export async function replayCustomerArImport(
    params: ReplayCustomerArImportParams
): Promise<ReplayCustomerSummary> {
    const db = params.dbClient ?? boundPrisma;
    const customerId = params.customerId;
    const linkDeferredPayments = params.linkDeferredPayments !== false;
    const stampInsuranceFields = params.stampInsuranceFields === true;
    const mepBreachStartDate = params.mepBreachStartDate ?? null;

    const [dbInvoices, dbPayments, insurance] = await Promise.all([
        db.invoice.findMany({
            where: { customer_id: customerId },
            select: {
                id: true,
                invoice_number: true,
                invoice_date: true,
                due_date: true,
                net_amount: true,
                customer_net_amount: true,
            },
        }),
        db.invoicePayment.findMany({
            where: { customer_id: customerId },
            select: {
                id: true,
                invoice_number: true,
                invoice_id: true,
                payment_date: true,
                amount: true,
                customer_amount: true,
            },
        }),
        db.customerPolicy.findFirst({
            where: {
                customer_id: customerId,
                is_active: true,
            },
            select: {
                approved_limit: true,
                approved_limit_currency: true,
                outdated_dcl: true,
                excluded_from_policy: true,
                insurance_policy_id: true,
            },
            orderBy: { id: "desc" },
        }),
    ]);

    let invoiceInputs: ReplayInvoiceInput[] =
        params.invoices ??
        dbInvoices
            .filter((inv) => inv.invoice_number && inv.invoice_date)
            .map((inv) => ({
                invoiceNumber: inv.invoice_number!,
                invoiceDate: inv.invoice_date!,
                netAmount: inv.net_amount ?? 0,
                customerNetAmount: inv.customer_net_amount ?? 0,
                invoiceId: inv.id,
            }));

    let paymentInputs: ReplayPaymentInput[] =
        params.payments ??
        dbPayments
            .filter((p) => p.invoice_number)
            .map((p) => ({
                id: p.id,
                invoiceNumber: p.invoice_number!,
                paymentDate: p.payment_date,
                amount: p.amount,
                customerAmount: p.customer_amount,
                invoiceId: p.invoice_id,
            }));

    let initialOpenAr = 0;
    if (mepBreachStartDate != null && !params.invoices && !params.payments) {
        initialOpenAr = await seedOpenArBeforeMepCutover(
            db,
            customerId,
            mepBreachStartDate
        );
        const filtered = filterReplayInputsForMepCutover({
            invoiceInputs,
            paymentInputs,
            mepBreachStartDate,
        });
        invoiceInputs = filtered.invoiceInputs;
        paymentInputs = filtered.paymentInputs;
    }

    const baseApprovedLimit =
        params.approvedLimit != null
            ? new Prisma.Decimal(params.approvedLimit)
            : (insurance?.approved_limit ?? null);
    const approvedLimit =
        baseApprovedLimit != null
            ? new Prisma.Decimal(baseApprovedLimit).toNumber()
            : 0;
    const limitCurrency =
        (params.approvedLimitCurrency ?? insurance?.approved_limit_currency)
            ?.trim()
            .toUpperCase() || null;

    // Prefetch top-ups once for the invoice date span, resolve each day in memory.
    const topUpTotalByDay = new Map<number, number>();
    if (params.topUpTotal == null && baseApprovedLimit != null) {
        const uniqueInvoiceDates = Array.from(
            new Map(
                invoiceInputs.map((inv) => [
                    calendarDayKey(inv.invoiceDate),
                    inv.invoiceDate,
                ])
            ).values()
        );
        const totalsByUtc = await resolveTopUpTotalsForAsOfDates(
            customerId,
            uniqueInvoiceDates,
            {
                baseApprovedLimit,
                baseApprovedLimitCurrency: limitCurrency,
                outdatedDcl: insurance?.outdated_dcl ?? false,
                excludedFromPolicy: insurance?.excluded_from_policy ?? false,
                ...(insurance?.insurance_policy_id != null
                    ? { parentPrimaryPolicyId: insurance.insurance_policy_id }
                    : {}),
                dbClient: db,
            }
        );
        for (const date of uniqueInvoiceDates) {
            topUpTotalByDay.set(
                calendarDayKey(date),
                totalsByUtc.get(utcDayKey(date)) ?? 0
            );
        }
    }

    const events = buildReplayEvents(invoiceInputs, paymentInputs);
    const invoiceIdByNumber = new Map(
        invoiceInputs
            .filter((inv) => inv.invoiceId != null)
            .map((inv) => [inv.invoiceNumber, inv.invoiceId!])
    );

    const assessedStamps: AssessedStamp[] = [];
    const deferredToLink: Array<{
        paymentId: number;
        invoiceId: number;
    }> = [];

    // Point-in-time open AR stays in memory only — never read live DB balances.
    const openArRunning = new Map<string, number>();
    const openOutstandingByInvoice = new Map<string, number>();
    if (initialOpenAr > 0) {
        openArRunning.set("default", initialOpenAr);
    }
    let deferredRemaining = 0;
    let eventsProcessed = 0;

    for (const event of events) {
        eventsProcessed += 1;
        if (eventsProcessed % 500 === 0 || eventsProcessed === events.length) {
            params.onProgress?.({
                processed: eventsProcessed,
                total: events.length,
            });
        }
        if (event.type === "invoice_open") {
            const payload = event.payload;
            const scopeKey = "default";
            const openBefore = openArRunning.get(scopeKey) ?? 0;
            const assessedOutstanding = Math.max(0, payload.netAmount);
            const dayKey = calendarDayKey(payload.invoiceDate);
            const topUpTotal =
                params.topUpTotal ?? topUpTotalByDay.get(dayKey) ?? 0;
            const limitAssessedAmount =
                computeLimitAssessedAmountForNewOpenInvoice({
                    approvedLimit,
                    topUpTotal,
                    openArOnPolicyBeforeInvoice: openBefore,
                    newInvoiceOutstanding: assessedOutstanding,
                });

            if (payload.invoiceId != null) {
                if (
                    mepBreachStartDate == null ||
                    isInvoiceInMepBreachScope(
                        payload.invoiceDate,
                        mepBreachStartDate
                    )
                ) {
                    assessedStamps.push({
                        invoiceId: payload.invoiceId,
                        invoiceDate: payload.invoiceDate,
                        limitAssessedAmount,
                    });
                }
                invoiceIdByNumber.set(payload.invoiceNumber, payload.invoiceId);
            }

            openArRunning.set(scopeKey, openBefore + assessedOutstanding);
            openOutstandingByInvoice.set(
                payload.invoiceNumber,
                (openOutstandingByInvoice.get(payload.invoiceNumber) ?? 0) +
                    assessedOutstanding
            );
            continue;
        }

        const payment = event.payload;
        const invoiceId =
            payment.invoiceId ??
            invoiceIdByNumber.get(payment.invoiceNumber) ??
            null;

        if (invoiceId == null) {
            deferredRemaining += 1;
            continue;
        }

        invoiceIdByNumber.set(payment.invoiceNumber, invoiceId);

        // Already linked during ingest: only advance the in-memory timeline.
        if (payment.invoiceId == null && linkDeferredPayments) {
            deferredToLink.push({ paymentId: payment.id, invoiceId });
        }

        const scopeKey = "default";
        const openOnInvoice =
            openOutstandingByInvoice.get(payment.invoiceNumber) ?? 0;
        const applied = Math.min(openOnInvoice, Math.max(0, payment.amount));
        if (applied > 0) {
            openOutstandingByInvoice.set(
                payment.invoiceNumber,
                openOnInvoice - applied
            );
            openArRunning.set(
                scopeKey,
                Math.max(0, (openArRunning.get(scopeKey) ?? 0) - applied)
            );
        }
    }

    const assessedAt = new Date();
    await bulkWriteLimitAssessedAmounts(
        db,
        assessedStamps,
        limitCurrency,
        assessedAt
    );
    params.onProgress?.({
        processed: events.length,
        total: events.length,
    });

    if (stampInsuranceFields && assessedStamps.length > 0) {
        await stampInvoicesInsuranceFieldsAsOf(
            assessedStamps.map((stamp) => ({
                invoiceId: stamp.invoiceId,
                asOf: stamp.invoiceDate,
            })),
            db
        );
    }

    let paymentsLinked = 0;
    if (linkDeferredPayments && deferredToLink.length > 0) {
        const recalcOptions = await resolveInvoicePaidRecalcOptions(
            db,
            params.accountId
        );
        const linkResult = await linkDeferredPaymentsAndRecalcBatch(
            db,
            deferredToLink.map((row) => ({
                invoicePaymentId: row.paymentId,
                invoiceId: row.invoiceId,
            })),
            recalcOptions
        );
        paymentsLinked = linkResult.paymentsLinked;
    }

    const stillDeferred = await db.invoicePayment.count({
        where: {
            customer_id: customerId,
            invoice_id: null,
        },
    });

    return {
        customerId,
        eventsApplied: events.length,
        paymentsLinked,
        deferredRemaining: Math.max(deferredRemaining, stillDeferred),
    };
}

export async function replayArImportForCustomers(
    customerIds: number[],
    accountId: number,
    dbClient?: PrismaClient
): Promise<ReplayBatchSummary> {
    const perCustomer: ReplayCustomerSummary[] = [];

    for (const customerId of customerIds) {
        perCustomer.push(
            await replayCustomerArImport({
                customerId,
                accountId,
                dbClient,
            })
        );
    }

    return {
        customersAffected: perCustomer.length,
        eventsApplied: perCustomer.reduce((s, c) => s + c.eventsApplied, 0),
        paymentsLinked: perCustomer.reduce((s, c) => s + c.paymentsLinked, 0),
        deferredRemaining: perCustomer.reduce(
            (s, c) => s + c.deferredRemaining,
            0
        ),
        perCustomer,
    };
}
