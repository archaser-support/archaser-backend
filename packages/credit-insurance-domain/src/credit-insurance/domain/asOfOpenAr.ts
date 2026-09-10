import { Prisma, type invoice_status } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";
import { convertAmountToCurrencyLatestRate } from "./customerCreditInsuranceHeaderAmounts";
import {
    allocateLiveCapacityGapWaterfall,
    compareInvoicesForLiveCapacityGapWaterfall,
    computeCreatedTermsViolationInvoiceAfterPolicyEnd,
    computeCustomerOverdueBlock,
    computeInvoiceInsuranceRowData,
    computeLimitExcessOverEffective,
    isEligibleForCustomerMepOverdue,
    isNegativeInvoiceAmount,
    type CustomerAtRiskInvoiceInput,
} from "./invoiceInsuranceFields";
import { computeInvoiceLineOpenArInAccountCurrency } from "./openReceivableByCustomerCurrency";
import { resolveInvoicePaidTolerance } from "./resolveInvoicePaidTolerance";
import { resolveMepBreachStartDate } from "./resolveMepBreachStartDate";
import {
    INVOICE_PAID_TOLERANCE,
    isWithinPaidTolerance,
} from "./invoicePaidTolerance";
import { isInvoiceInMepBreachScope } from "./shared/mepBreachScope";

/** Invoice statuses excluded from as-of open AR (cancelled / void book). */
export const ASOF_OPEN_AR_EXCLUDED_STATUSES = ["Void", "Cancelled"] as const;

export type AsOfAmountPair = {
    /** Primary / account-side amount (invoice `amount`, payment `amount`). */
    amount: number | null | undefined;
    /** Customer-currency amount (`customer_amount`). */
    customerAmount: number | null | undefined;
};

/**
 * Prefer primary amount when non-zero, else customer amount — same COALESCE
 * spirit as live open-AR line outstanding.
 */
export function preferAmountPair(pair: AsOfAmountPair): number {
    const primary = Number(pair.amount ?? 0);
    if (primary !== 0) {
        return primary;
    }
    return Number(pair.customerAmount ?? 0);
}

/** @deprecated Prefer {@link INVOICE_PAID_TOLERANCE} — same shared default. */
export const ASOF_OPEN_AMOUNT_TOLERANCE = INVOICE_PAID_TOLERANCE;

/**
 * Payment-ledger open amount as of day D: original − payments on/before D.
 * Near-zero residue uses shared {@link isWithinPaidTolerance} (Billing Paid
 * leftover / CPT as-of open AR).
 */
export function computeAsOfOpenAmount(
    original: number,
    paymentsOnOrBeforeAsOf: number,
    tolerance: number = INVOICE_PAID_TOLERANCE
): number {
    const open = Number(original) - Number(paymentsOnOrBeforeAsOf);
    if (!Number.isFinite(open)) {
        return 0;
    }
    if (isWithinPaidTolerance(open, tolerance)) {
        return 0;
    }
    return open;
}

/**
 * Customer-currency as-of open (Billing Paid leftover band).
 * Prefer customer amounts; fall back to document amounts when customer is unset.
 */
export function computeAsOfOpenCustomerAmount(
    line: Pick<
        AsOfOpenInvoiceLine,
        | "amount"
        | "customerAmount"
        | "paymentsOnOrBeforeAsOf"
        | "paymentsCustomerOnOrBeforeAsOf"
        | "openAmountTolerance"
    >
): number {
    const tolerance = line.openAmountTolerance ?? INVOICE_PAID_TOLERANCE;
    const original =
        Number(line.customerAmount ?? 0) || Number(line.amount ?? 0);
    const paid =
        Number(line.paymentsCustomerOnOrBeforeAsOf ?? 0) ||
        Number(line.paymentsOnOrBeforeAsOf ?? 0);
    return computeAsOfOpenAmount(original, paid, tolerance);
}

/**
 * Account/document-side as-of open (portfolio AR currency path).
 * When customer-currency leftover is within Paid tolerance, both sides are
 * treated as closed — same decision Billing uses to stamp status Paid.
 */
export function computeAsOfOpenAccountAmount(
    line: Pick<
        AsOfOpenInvoiceLine,
        | "amount"
        | "customerAmount"
        | "paymentsOnOrBeforeAsOf"
        | "paymentsCustomerOnOrBeforeAsOf"
        | "openAmountTolerance"
    >
): number {
    const tolerance = line.openAmountTolerance ?? INVOICE_PAID_TOLERANCE;
    if (computeAsOfOpenCustomerAmount(line) === 0) {
        return 0;
    }
    return computeAsOfOpenAmount(
        preferAmountPair({
            amount: line.amount,
            customerAmount: line.customerAmount,
        }),
        preferAmountPair({
            amount: line.paymentsOnOrBeforeAsOf,
            customerAmount: line.paymentsCustomerOnOrBeforeAsOf,
        }),
        tolerance
    );
}

export type AsOfOpenStatus = "Due" | "Overdue";

/**
 * Classify remaining open balance vs due date on as-of day D (UTC calendar).
 */
export function classifyAsOfOpenStatus(
    dueDate: Date | null | undefined,
    asOfDate: Date
): AsOfOpenStatus {
    if (!dueDate) {
        return "Due";
    }
    const due = toUtcDayStart(dueDate);
    const asOf = toUtcDayStart(asOfDate);
    return due.getTime() < asOf.getTime() ? "Overdue" : "Due";
}

export function toUtcDayStart(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

/** Exclusive upper bound: first UTC instant after as-of calendar day. */
export function utcDayAfterExclusive(asOfDate: Date): Date {
    const next = toUtcDayStart(asOfDate);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
}

export type AsOfOpenInvoiceLine = {
    invoiceId: number;
    customerId: number;
    policyId: number | null;
    invoiceDate: Date;
    dueDate: Date | null;
    amount: number | null;
    customerAmount: number | null;
    customerCurrency: string | null;
    paymentsOnOrBeforeAsOf: number;
    paymentsCustomerOnOrBeforeAsOf: number;
    /**
     * True last payment date on the invoice (any day). Used with
     * {@link wasAsOfInvoiceOpenAt} when live status is Paid but the payment
     * ledger as of the snapshot day is already zero — only then does a later
     * payment date reopen history. Payment *sums* stay as-of the snapshot day.
     */
    lastPaymentDate?: Date | null;
    /**
     * Invoice row itself reports settled *today*. Must not erase history: when
     * payments on/before the snapshot day leave a non-zero open amount, the
     * invoice was open on that day even if status is Paid now.
     */
    liveClosed?: boolean;
    /**
     * Residue threshold for Open invoices. Also used when deciding whether a
     * currently-Paid invoice still had open AR on the snapshot day.
     */
    openAmountTolerance?: number;
    reportingBreach: boolean;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl: boolean;
    ctvInvoiceAfterPolicyEnd: boolean;
    inCapacityGap: boolean;
    capacityGapAmount?: number;
    actualReportingDate?: Date | null;
};

/** Policy terms used to recompute invoice breach flags as of a snapshot day. */
export type AsOfPolicyTermsForBreach = {
    maxPaymentTerm: number | null;
    maxAllowedMep: number | null;
    reportingDays: number | null;
    mepCutoffDay?: number | null;
    mepSubstituteExtraDays?: number | null;
    reportingCutoffDay?: number | null;
    reportingSubstituteExtraDays?: number | null;
    paymentTermCutoffDay?: number | null;
    paymentTermSubstituteDay?: number | null;
    policyEndDate?: Date | null;
};

/**
 * Over-limit slice as of the snapshot day. Outdated DCL suppresses the gap
 * (same rule as live capacity-gap computation).
 */
export function asOfCapacityGapAmount(
    totalReceivables: number,
    effectiveApprovedLimit: number | null | undefined,
    outdatedDcl: boolean
): number {
    if (outdatedDcl) {
        return 0;
    }
    return computeLimitExcessOverEffective(
        totalReceivables,
        effectiveApprovedLimit
    );
}

/** Effective limit + currency for one customer+policy as-of waterfall scope. */
export type AsOfCapacityGapWaterfallScope = {
    effectiveLimit: number;
    limitCurrency: string | null;
    /** Uncovered / outdated DCL — force invoice gaps to 0. */
    zeroGaps?: boolean;
};

function asOfOutstandingInLimitCurrency(
    computed: AsOfOpenInvoiceComputed,
    limitCurrency: string | null,
    accountCurrency: string | null
): number {
    const limitCcy = limitCurrency?.trim().toUpperCase() ?? null;
    const acct = accountCurrency?.trim().toUpperCase() ?? null;
    if (limitCcy && acct && limitCcy === acct) {
        return Math.max(0, computed.openAmount);
    }
    const cust = computed.customerCurrency?.trim().toUpperCase() ?? null;
    if (limitCcy && cust && limitCcy === cust) {
        return Math.max(
            0,
            computed.openCustomerAmount > 0
                ? computed.openCustomerAmount
                : computed.openAmount
        );
    }
    return Math.max(0, computed.openAmount);
}

function asOfGapLimitToAccountCurrency(
    gapLimit: number,
    outstandingLimit: number,
    openAmountAccount: number,
    limitCurrency: string | null,
    accountCurrency: string | null
): number {
    const limitCcy = limitCurrency?.trim().toUpperCase() ?? null;
    const acct = accountCurrency?.trim().toUpperCase() ?? null;
    if (gapLimit <= 0) {
        return 0;
    }
    if (!limitCcy || !acct || limitCcy === acct) {
        return gapLimit;
    }
    if (outstandingLimit > 0 && openAmountAccount > 0) {
        return gapLimit * (openAmountAccount / outstandingLimit);
    }
    return gapLimit;
}

/**
 * Rewrite `capacityGapAmount` / `inCapacityGap` on as-of open lines using the
 * live waterfall as of `asOfDate` (oldest invoice_date first). Does not persist.
 * Scopes missing from the map keep sticky stored gaps.
 */
export function overlayAsOfLiveCapacityGapWaterfallOnLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    options: {
        scopeByCustomerPolicy: Map<string, AsOfCapacityGapWaterfallScope>;
        accountCurrency: string | null;
    }
): AsOfOpenInvoiceLine[] {
    if (options.scopeByCustomerPolicy.size === 0) {
        return lines;
    }

    type OpenRow = {
        line: AsOfOpenInvoiceLine;
        computed: AsOfOpenInvoiceComputed;
        outstandingLimit: number;
    };
    const openByScope = new Map<string, OpenRow[]>();

    for (const line of lines) {
        if (isNegativeInvoiceAmount(line.amount)) {
            continue;
        }
        const scopeKey = asOfTermsScopeKey(line.customerId, line.policyId);
        if (!options.scopeByCustomerPolicy.has(scopeKey)) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        const scope = options.scopeByCustomerPolicy.get(scopeKey)!;
        const outstandingLimit = asOfOutstandingInLimitCurrency(
            computed,
            scope.limitCurrency,
            options.accountCurrency
        );
        const bucket = openByScope.get(scopeKey) ?? [];
        bucket.push({ line, computed, outstandingLimit });
        openByScope.set(scopeKey, bucket);
    }

    const gapByInvoiceId = new Map<
        number,
        { capacityGapAmount: number; inCapacityGap: boolean }
    >();

    for (const [scopeKey, rows] of openByScope) {
        const scope = options.scopeByCustomerPolicy.get(scopeKey)!;
        if (scope.zeroGaps === true) {
            for (const row of rows) {
                gapByInvoiceId.set(row.line.invoiceId, {
                    capacityGapAmount: 0,
                    inCapacityGap: false,
                });
            }
            continue;
        }

        const sorted = rows
            .slice()
            .sort((a, b) =>
                compareInvoicesForLiveCapacityGapWaterfall(
                    {
                        invoice_date: a.line.invoiceDate,
                        id: a.line.invoiceId,
                    },
                    {
                        invoice_date: b.line.invoiceDate,
                        id: b.line.invoiceId,
                    }
                )
            );

        const allocations = allocateLiveCapacityGapWaterfall({
            effectiveLimit: scope.effectiveLimit,
            openInvoices: sorted.map((row) => ({
                id: row.line.invoiceId,
                outstandingInLimitCurrency: row.outstandingLimit,
            })),
        });
        const allocationById = new Map(
            allocations.map((row) => [row.id, row] as const)
        );

        for (const row of sorted) {
            const allocation = allocationById.get(row.line.invoiceId);
            const gapLimit = allocation?.capacityGapAmountLimit ?? 0;
            const gapAccount = asOfGapLimitToAccountCurrency(
                gapLimit,
                row.outstandingLimit,
                row.computed.openAmount,
                scope.limitCurrency,
                options.accountCurrency
            );
            gapByInvoiceId.set(row.line.invoiceId, {
                capacityGapAmount: Math.max(0, gapAccount),
                inCapacityGap: gapLimit > 0,
            });
        }
    }

    if (gapByInvoiceId.size === 0) {
        return lines;
    }

    return lines.map((line) => {
        const next = gapByInvoiceId.get(line.invoiceId);
        if (!next) {
            return line;
        }
        return {
            ...line,
            capacityGapAmount: next.capacityGapAmount,
            inCapacityGap: next.inCapacityGap,
        };
    });
}

/**
 * Whether `line` still had open AR on calendar day `atDate`.
 *
 * Prefer customer-currency Paid leftover (± tolerance). Payment sums are usually
 * already as-of `atDate`; created-in-MEP may reuse lines loaded for a later
 * snapshot day — then a zero residue with `lastPaymentDate` after `atDate`
 * still means open on `atDate` (paid later).
 */
export function wasAsOfInvoiceOpenAt(
    line: AsOfOpenInvoiceLine,
    atDate: Date
): boolean {
    const at = toUtcDayStart(atDate);
    if (toUtcDayStart(line.invoiceDate).getTime() > at.getTime()) {
        return false;
    }
    const openCustomer = computeAsOfOpenCustomerAmount(line);
    if (openCustomer !== 0) {
        return true;
    }
    // Sums may include payments after `atDate` (MEP overlay on snapshot-loaded
    // siblings). Closing payment after `atDate` ⇒ still open that day.
    if (
        line.lastPaymentDate &&
        toUtcDayStart(line.lastPaymentDate).getTime() > at.getTime()
    ) {
        return true;
    }
    if (line.liveClosed) {
        return false;
    }
    const original =
        Number(line.customerAmount ?? 0) || Number(line.amount ?? 0);
    const paidAsOfLoad =
        Number(line.paymentsCustomerOnOrBeforeAsOf ?? 0) ||
        Number(line.paymentsOnOrBeforeAsOf ?? 0);
    if (paidAsOfLoad <= 0) {
        const tolerance = line.openAmountTolerance ?? INVOICE_PAID_TOLERANCE;
        return !isWithinPaidTolerance(original, tolerance);
    }
    return false;
}

/**
 * Customer overdue_block as of `atDate`: oldest overdue due among invoices
 * still open that day, plus max allowed MEP.
 *
 * `mepBreachStartDate` drops invoices issued before the account's configured
 * date from the candidate set, using the same shared predicate as the live
 * block computation so replay and live cannot disagree.
 */
export type CustomerOverdueMepMonthEnd = {
    mepCutoffDay?: number | null;
    mepSubstituteExtraDays?: number | null;
};

export function asOfCustomerOverdueBlockAt(
    customerLines: AsOfOpenInvoiceLine[],
    atDate: Date,
    maxAllowedMep: number | null | undefined,
    mepBreachStartDate?: Date | null,
    monthEnd?: CustomerOverdueMepMonthEnd
): boolean {
    let oldestOverdueDue: Date | null = null;
    let oldestOverdueIssueDate: Date | null = null;
    for (const line of customerLines) {
        if (!isInvoiceInMepBreachScope(line.invoiceDate, mepBreachStartDate)) {
            continue;
        }
        if (!wasAsOfInvoiceOpenAt(line, atDate)) {
            continue;
        }
        if (classifyAsOfOpenStatus(line.dueDate, atDate) !== "Overdue") {
            continue;
        }
        if (isNegativeInvoiceAmount(line.amount)) {
            continue;
        }
        if (!line.dueDate) {
            continue;
        }
        const due = toUtcDayStart(line.dueDate);
        const issue = toUtcDayStart(line.invoiceDate);
        if (
            !oldestOverdueDue ||
            due.getTime() < oldestOverdueDue.getTime() ||
            (due.getTime() === oldestOverdueDue.getTime() &&
                issue.getTime() < (oldestOverdueIssueDate?.getTime() ?? Infinity))
        ) {
            oldestOverdueDue = due;
            oldestOverdueIssueDate = issue;
        }
    }
    return computeCustomerOverdueBlock({
        oldestInvoiceOverdueDate: oldestOverdueDue,
        maxAllowedMepDays: maxAllowedMep,
        today: atDate,
        oldestInvoiceIssueDate: oldestOverdueIssueDate,
        mepCutoffDay: monthEnd?.mepCutoffDay,
        mepSubstituteExtraDays: monthEnd?.mepSubstituteExtraDays,
    });
}

/**
 * Created-in-MEP: invoice was issued while the customer overdue block was
 * already on. Shared by CPT terms overlay and live CTV stamp
 * ({@link resolveCreatedOverdueMepByInvoiceId}).
 *
 * Credit notes and out-of-scope issue dates are never flagged. Sibling lines
 * must cover the customer's open book; payment sums may be loaded for a later
 * cutoff — {@link wasAsOfInvoiceOpenAt} uses `lastPaymentDate` for pay-later.
 */
export function isCreatedInCustomerOverdueMep(args: {
    invoiceDate: Date;
    amount: number | null | undefined;
    siblingLines: AsOfOpenInvoiceLine[];
    maxAllowedMep: number | null | undefined;
    mepBreachStartDate?: Date | null;
    monthEnd?: CustomerOverdueMepMonthEnd;
}): boolean {
    if (args.maxAllowedMep == null) {
        return false;
    }
    if (!isEligibleForCustomerMepOverdue(args.amount)) {
        return false;
    }
    if (
        !isInvoiceInMepBreachScope(
            args.invoiceDate,
            args.mepBreachStartDate
        )
    ) {
        return false;
    }
    return asOfCustomerOverdueBlockAt(
        args.siblingLines,
        args.invoiceDate,
        args.maxAllowedMep,
        args.mepBreachStartDate,
        args.monthEnd
    );
}

/**
 * Exclusive upper bound on calendar-day `T` for which
 * {@link wasAsOfInvoiceOpenAt} is true (assuming `invoiceDate <= T`).
 * `null` means never open for any such `T`.
 */
function resolveAsOfOpenUntilExclusiveMs(
    line: AsOfOpenInvoiceLine
): number | null {
    const openCustomer = computeAsOfOpenCustomerAmount(line);
    if (openCustomer !== 0) {
        return Number.POSITIVE_INFINITY;
    }
    if (line.lastPaymentDate) {
        return toUtcDayStart(line.lastPaymentDate).getTime();
    }
    if (line.liveClosed) {
        return null;
    }
    const original =
        Number(line.customerAmount ?? 0) || Number(line.amount ?? 0);
    const paidAsOfLoad =
        Number(line.paymentsCustomerOnOrBeforeAsOf ?? 0) ||
        Number(line.paymentsOnOrBeforeAsOf ?? 0);
    if (paidAsOfLoad <= 0) {
        const tolerance = line.openAmountTolerance ?? INVOICE_PAID_TOLERANCE;
        if (!isWithinPaidTolerance(original, tolerance)) {
            return Number.POSITIVE_INFINITY;
        }
    }
    return null;
}

const MS_PER_UTC_DAY = 86_400_000;

/**
 * Oldest overdue sibling open on an invoice's issue date (due + that sibling's
 * issue date for the Extra Days cutoff gate). Same selection
 * {@link asOfCustomerOverdueBlockAt} uses before applying max MEP / Extra Days.
 *
 * Chronological sweep: O(C log C) activate/deactivate instead of O(C²) sibling
 * rescans (CPT Generate bottleneck when one customer has hundreds of invoices).
 */
export type OldestOverdueAtIssue = {
    dueDate: Date;
    invoiceDate: Date;
};

export function oldestOverdueDueAtEachInvoiceIssueDate(
    customerLines: AsOfOpenInvoiceLine[],
    mepBreachStartDate?: Date | null
): Map<number, OldestOverdueAtIssue | null> {
    type Cand = {
        invoiceId: number;
        activateMs: number;
        deactivateMs: number;
        dueDateMs: number;
        dueDate: Date;
        invoiceDateMs: number;
        invoiceDate: Date;
    };
    const cands: Cand[] = [];
    for (const line of customerLines) {
        if (!isEligibleForCustomerMepOverdue(line.amount)) {
            continue;
        }
        if (
            !isInvoiceInMepBreachScope(line.invoiceDate, mepBreachStartDate)
        ) {
            continue;
        }
        if (!line.dueDate) {
            continue;
        }
        const openUntilMs = resolveAsOfOpenUntilExclusiveMs(line);
        if (openUntilMs == null) {
            continue;
        }
        const invoiceDate = toUtcDayStart(line.invoiceDate);
        const invoiceDateMs = invoiceDate.getTime();
        const dueDate = toUtcDayStart(line.dueDate);
        const dueDateMs = dueDate.getTime();
        // Overdue when dueDate < T ⇒ first active UTC day is the day after due.
        const activateMs = Math.max(
            invoiceDateMs,
            dueDateMs + MS_PER_UTC_DAY
        );
        if (!(activateMs < openUntilMs)) {
            continue;
        }
        cands.push({
            invoiceId: line.invoiceId,
            activateMs,
            deactivateMs: openUntilMs,
            dueDateMs,
            dueDate,
            invoiceDateMs,
            invoiceDate,
        });
    }

    type Query = { invoiceId: number; tMs: number };
    const queries: Query[] = customerLines.map((line) => ({
        invoiceId: line.invoiceId,
        tMs: toUtcDayStart(line.invoiceDate).getTime(),
    }));
    queries.sort(
        (a, b) => a.tMs - b.tMs || a.invoiceId - b.invoiceId
    );

    const byActivate = cands
        .slice()
        .sort((a, b) => a.activateMs - b.activateMs);
    const byDeactivate = cands
        .slice()
        .sort((a, b) => a.deactivateMs - b.deactivateMs);

    type DueBucket = {
        count: number;
        dueDate: Date;
        byInvoiceId: Map<number, Date>;
    };
    const dueMeta = new Map<number, DueBucket>();
    let cachedMin: OldestOverdueAtIssue | null = null;
    let cachedMinDueMs: number | null = null;

    function pickMinInvoiceDate(
        byInvoiceId: Map<number, Date>
    ): Date | null {
        let best: Date | null = null;
        for (const invoiceDate of byInvoiceId.values()) {
            if (!best || invoiceDate.getTime() < best.getTime()) {
                best = invoiceDate;
            }
        }
        return best;
    }

    function recomputeMin(): void {
        cachedMinDueMs = null;
        cachedMin = null;
        for (const [ms, meta] of dueMeta) {
            if (meta.count <= 0) {
                continue;
            }
            if (cachedMinDueMs == null || ms < cachedMinDueMs) {
                const invoiceDate = pickMinInvoiceDate(meta.byInvoiceId);
                if (!invoiceDate) {
                    continue;
                }
                cachedMinDueMs = ms;
                cachedMin = { dueDate: meta.dueDate, invoiceDate };
            }
        }
    }

    function addCand(cand: Cand): void {
        const prev = dueMeta.get(cand.dueDateMs);
        if (prev) {
            prev.count += 1;
            prev.byInvoiceId.set(cand.invoiceId, cand.invoiceDate);
        } else {
            dueMeta.set(cand.dueDateMs, {
                count: 1,
                dueDate: cand.dueDate,
                byInvoiceId: new Map([[cand.invoiceId, cand.invoiceDate]]),
            });
        }
        if (cachedMinDueMs == null || cand.dueDateMs < cachedMinDueMs) {
            cachedMinDueMs = cand.dueDateMs;
            cachedMin = {
                dueDate: cand.dueDate,
                invoiceDate: cand.invoiceDate,
            };
        } else if (cachedMinDueMs === cand.dueDateMs) {
            if (
                !cachedMin ||
                cand.invoiceDateMs < cachedMin.invoiceDate.getTime()
            ) {
                cachedMin = {
                    dueDate: cand.dueDate,
                    invoiceDate: cand.invoiceDate,
                };
            }
        }
    }

    function removeCand(cand: Cand): void {
        const prev = dueMeta.get(cand.dueDateMs);
        if (!prev) {
            return;
        }
        prev.count -= 1;
        prev.byInvoiceId.delete(cand.invoiceId);
        if (prev.count <= 0) {
            dueMeta.delete(cand.dueDateMs);
            if (cachedMinDueMs === cand.dueDateMs) {
                recomputeMin();
            }
        } else if (cachedMinDueMs === cand.dueDateMs) {
            const invoiceDate = pickMinInvoiceDate(prev.byInvoiceId);
            cachedMin = invoiceDate
                ? { dueDate: prev.dueDate, invoiceDate }
                : null;
            if (!cachedMin) {
                recomputeMin();
            }
        }
    }

    let activateIndex = 0;
    let deactivateIndex = 0;
    const oldestByInvoiceId = new Map<number, OldestOverdueAtIssue | null>();

    for (const query of queries) {
        const tMs = query.tMs;
        while (
            activateIndex < byActivate.length &&
            byActivate[activateIndex]!.activateMs <= tMs
        ) {
            addCand(byActivate[activateIndex]!);
            activateIndex += 1;
        }
        while (
            deactivateIndex < byDeactivate.length &&
            byDeactivate[deactivateIndex]!.deactivateMs <= tMs
        ) {
            removeCand(byDeactivate[deactivateIndex]!);
            deactivateIndex += 1;
        }
        oldestByInvoiceId.set(query.invoiceId, cachedMin);
    }

    return oldestByInvoiceId;
}

/**
 * Recompute terms-breach flags for an as-of-open invoice from policy terms and
 * the snapshot calendar day. MEP is created-in-violation via
 * {@link isCreatedInCustomerOverdueMep}.
 */
export function overlayAsOfTermsFlagsOnLine(
    line: AsOfOpenInvoiceLine,
    asOfDate: Date,
    terms: AsOfPolicyTermsForBreach,
    options?: {
        siblingLines?: AsOfOpenInvoiceLine[];
        /** Snapshot math only — do not count reporting-late. Invoice rows stay unchanged. */
        ignoreReportingBreach?: boolean;
        /** Account's MEP breach start date; null / omitted means no gate. */
        mepBreachStartDate?: Date | null;
        /**
         * When set (batch overlay), skip the O(siblings) MEP scan and use this
         * precomputed oldest overdue (due + issue date) at the line's issue date.
         */
        oldestOverdueAtIssue?: OldestOverdueAtIssue | null;
    }
): AsOfOpenInvoiceLine {
    const asOfStatus = classifyAsOfOpenStatus(line.dueDate, asOfDate);
    const row = computeInvoiceInsuranceRowData({
        status: asOfStatus as invoice_status,
        invoice_date: line.invoiceDate,
        due_date: line.dueDate,
        amount: line.amount,
        actual_reporting_date: line.actualReportingDate ?? null,
        customer: {
            reporting_days: terms.reportingDays,
            max_allowed_mep: terms.maxAllowedMep,
            max_payment_term: terms.maxPaymentTerm,
            mep_cutoff_day: terms.mepCutoffDay,
            mep_substitute_extra_days: terms.mepSubstituteExtraDays,
            reporting_cutoff_day: terms.reportingCutoffDay,
            reporting_substitute_extra_days:
                terms.reportingSubstituteExtraDays,
            payment_term_cutoff_day: terms.paymentTermCutoffDay,
            payment_term_substitute_day:
                terms.paymentTermSubstituteDay,
        },
        today: asOfDate,
    });
    const monthEnd: CustomerOverdueMepMonthEnd = {
        mepCutoffDay: terms.mepCutoffDay,
        mepSubstituteExtraDays: terms.mepSubstituteExtraDays,
    };
    let ctvCustomerOverdueMep: boolean;
    if (options && "oldestOverdueAtIssue" in options) {
        ctvCustomerOverdueMep =
            terms.maxAllowedMep == null ||
            !isEligibleForCustomerMepOverdue(line.amount) ||
            !isInvoiceInMepBreachScope(
                line.invoiceDate,
                options.mepBreachStartDate
            )
                ? false
                : computeCustomerOverdueBlock({
                      oldestInvoiceOverdueDate:
                          options.oldestOverdueAtIssue?.dueDate ?? null,
                      maxAllowedMepDays: terms.maxAllowedMep,
                      today: line.invoiceDate,
                      oldestInvoiceIssueDate:
                          options.oldestOverdueAtIssue?.invoiceDate ?? null,
                      mepCutoffDay: monthEnd.mepCutoffDay,
                      mepSubstituteExtraDays: monthEnd.mepSubstituteExtraDays,
                  });
    } else {
        const siblingLines = options?.siblingLines ?? [line];
        ctvCustomerOverdueMep = isCreatedInCustomerOverdueMep({
            invoiceDate: line.invoiceDate,
            amount: line.amount,
            siblingLines,
            maxAllowedMep: terms.maxAllowedMep,
            mepBreachStartDate: options?.mepBreachStartDate,
            monthEnd,
        });
    }

    return {
        ...line,
        reportingBreach: options?.ignoreReportingBreach
            ? false
            : row.reporting_breach,
        ctvPaymentTerm: row.ctv_payment_term,
        ctvCustomerOverdueMep,
        ctvInvoiceAfterPolicyEnd: terms.policyEndDate
            ? computeCreatedTermsViolationInvoiceAfterPolicyEnd(
                  line.invoiceDate,
                  terms.policyEndDate
              )
            : line.ctvInvoiceAfterPolicyEnd,
    };
}

export function overlayAsOfTermsFlagsOnLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    termsByCustomerAndPolicy: Map<string, AsOfPolicyTermsForBreach>,
    options?: {
        ignoreReportingBreach?: boolean;
        /** Resolved once per replay run and threaded down; null means no gate. */
        mepBreachStartDate?: Date | null;
    }
): AsOfOpenInvoiceLine[] {
    const linesByCustomer = new Map<number, AsOfOpenInvoiceLine[]>();
    for (const line of lines) {
        const bucket = linesByCustomer.get(line.customerId) ?? [];
        bucket.push(line);
        linesByCustomer.set(line.customerId, bucket);
    }

    const oldestOverdueAtIssueByInvoiceId = new Map<
        number,
        OldestOverdueAtIssue | null
    >();
    for (const customerLines of linesByCustomer.values()) {
        const oldestByInvoice = oldestOverdueDueAtEachInvoiceIssueDate(
            customerLines,
            options?.mepBreachStartDate
        );
        for (const [invoiceId, oldest] of oldestByInvoice) {
            oldestOverdueAtIssueByInvoiceId.set(invoiceId, oldest);
        }
    }

    return lines.map((line) => {
        const exact = termsByCustomerAndPolicy.get(
            `${line.customerId}:${line.policyId ?? "none"}`
        );
        const fallback = termsByCustomerAndPolicy.get(
            `${line.customerId}:none`
        );
        const terms = exact ?? fallback;
        if (!terms) {
            if (options?.ignoreReportingBreach) {
                return { ...line, reportingBreach: false };
            }
            return line;
        }
        return overlayAsOfTermsFlagsOnLine(line, asOfDate, terms, {
            ignoreReportingBreach: options?.ignoreReportingBreach,
            mepBreachStartDate: options?.mepBreachStartDate,
            oldestOverdueAtIssue:
                oldestOverdueAtIssueByInvoiceId.get(line.invoiceId) ?? null,
        });
    });
}

/** Force reporting-late off on ledger lines (dashboard snapshot path). */
export function withReportingBreachIgnored(
    lines: AsOfOpenInvoiceLine[],
    ignoreReportingBreach: boolean
): AsOfOpenInvoiceLine[] {
    if (!ignoreReportingBreach) {
        return lines;
    }
    return lines.map((line) => ({ ...line, reportingBreach: false }));
}

export function asOfTermsScopeKey(
    customerId: number,
    policyId: number | null | undefined
): string {
    return `${customerId}:${policyId ?? "none"}`;
}

/**
 * Build the terms map CPT Generate / dashboard as-of overlay both need from
 * enriched customer + active policy rows.
 */
export function buildAsOfPolicyTermsByCustomerMap(
    customers: Array<{
        id: number;
        policy_id?: number | null;
        max_payment_term?: number | null;
        max_allowed_mep?: number | null;
        reporting_days?: number | null;
        mep_cutoff_day?: number | null;
        mep_substitute_extra_days?: number | null;
        reporting_cutoff_day?: number | null;
        reporting_substitute_extra_days?: number | null;
        payment_term_cutoff_day?: number | null;
        payment_term_substitute_day?: number | null;
        InsurancePolicy?: { end_date: Date | null } | null;
    }>
): Map<string, AsOfPolicyTermsForBreach> {
    const termsByCustomerAndPolicy = new Map<string, AsOfPolicyTermsForBreach>();
    for (const customer of customers) {
        const terms: AsOfPolicyTermsForBreach = {
            maxPaymentTerm: customer.max_payment_term ?? null,
            maxAllowedMep: customer.max_allowed_mep ?? null,
            reportingDays: customer.reporting_days ?? null,
            mepCutoffDay: customer.mep_cutoff_day ?? null,
            mepSubstituteExtraDays: customer.mep_substitute_extra_days ?? null,
            reportingCutoffDay: customer.reporting_cutoff_day ?? null,
            reportingSubstituteExtraDays:
                customer.reporting_substitute_extra_days ?? null,
            paymentTermCutoffDay: customer.payment_term_cutoff_day ?? null,
            paymentTermSubstituteDay:
                customer.payment_term_substitute_day ?? null,
            policyEndDate: customer.InsurancePolicy?.end_date ?? null,
        };
        termsByCustomerAndPolicy.set(
            asOfTermsScopeKey(customer.id, customer.policy_id ?? null),
            terms
        );
        const fallbackKey = asOfTermsScopeKey(customer.id, null);
        if (!termsByCustomerAndPolicy.has(fallbackKey)) {
            termsByCustomerAndPolicy.set(fallbackKey, terms);
        }
    }
    return termsByCustomerAndPolicy;
}

/**
 * Apply created-in-MEP / payment-term / after-policy-end overlay used by CPT
 * Generate and dashboard as-of summary.
 */
export async function overlayAsOfTermsFlagsForAccountLines(args: {
    accountId: number;
    asOfDate: Date;
    lines: AsOfOpenInvoiceLine[];
    customers: Array<{
        id: number;
        policy_id?: number | null;
        max_payment_term?: number | null;
        max_allowed_mep?: number | null;
        reporting_days?: number | null;
        mep_cutoff_day?: number | null;
        mep_substitute_extra_days?: number | null;
        reporting_cutoff_day?: number | null;
        reporting_substitute_extra_days?: number | null;
        payment_term_cutoff_day?: number | null;
        payment_term_substitute_day?: number | null;
        InsurancePolicy?: { end_date: Date | null } | null;
    }>;
    ignoreReportingBreach?: boolean;
    mepBreachStartDate?: Date | null;
    dbClient?: DbClient;
}): Promise<AsOfOpenInvoiceLine[]> {
    const mepBreachStartDate =
        args.mepBreachStartDate !== undefined
            ? args.mepBreachStartDate
            : await resolveMepBreachStartDate(args.accountId, args.dbClient);
    return overlayAsOfTermsFlagsOnLines(
        args.lines,
        args.asOfDate,
        buildAsOfPolicyTermsByCustomerMap(args.customers),
        {
            ignoreReportingBreach: args.ignoreReportingBreach === true,
            mepBreachStartDate,
        }
    );
}

export type AsOfOpenInvoiceComputed = AsOfOpenInvoiceLine & {
    openAmount: number;
    openCustomerAmount: number;
    status: AsOfOpenStatus;
};

export function computeAsOfOpenInvoiceLine(
    line: AsOfOpenInvoiceLine,
    asOfDate: Date
): AsOfOpenInvoiceComputed | null {
    if (line.liveClosed && !wasAsOfInvoiceOpenAt(line, asOfDate)) {
        return null;
    }
    const openCustomerAmount = computeAsOfOpenCustomerAmount(line);
    // Billing Paid leftover is customer-currency ± tolerance. Within band →
    // closed for CPT AR, MEP overdue-block, and health (ignore doc-currency dust).
    if (openCustomerAmount === 0) {
        return null;
    }
    const openAmount = computeAsOfOpenAccountAmount(line);
    if (openAmount === 0) {
        return null;
    }
    return {
        ...line,
        openAmount,
        openCustomerAmount,
        status: classifyAsOfOpenStatus(line.dueDate, asOfDate),
    };
}

function isTermsBreachLine(line: AsOfOpenInvoiceLine): boolean {
    if (isNegativeInvoiceAmount(line.amount)) {
        return false;
    }
    return (
        line.reportingBreach ||
        line.ctvPaymentTerm ||
        line.ctvCustomerOverdueMep ||
        line.ctvOutdatedDcl ||
        line.ctvInvoiceAfterPolicyEnd
    );
}

type AsOfInvoiceSqlRow = {
    invoice_id: number;
    customer_id: number;
    policy_id: number | null;
    invoice_date: Date;
    due_date: Date | null;
    amount: number | null;
    customer_amount: number | null;
    customer_currency: string | null;
    paid_amount: number | null;
    paid_customer_amount: number | null;
    reporting_breach: boolean;
    ctv_payment_term: boolean;
    ctv_customer_overdue_mep: boolean;
    ctv_outdated_dcl: boolean;
    ctv_invoice_after_policy_end: boolean;
    in_capacity_gap: boolean;
    capacity_gap_amount: number | null;
    actual_reporting_date: Date | null;
    last_payment_date: Date | null;
    status: string;
};

function mapSqlRow(
    row: AsOfInvoiceSqlRow,
    openAmountTolerance: number
): AsOfOpenInvoiceLine {
    return {
        invoiceId: Number(row.invoice_id),
        customerId: Number(row.customer_id),
        policyId: row.policy_id != null ? Number(row.policy_id) : null,
        invoiceDate: row.invoice_date,
        dueDate: row.due_date,
        amount: row.amount != null ? Number(row.amount) : null,
        customerAmount:
            row.customer_amount != null ? Number(row.customer_amount) : null,
        customerCurrency: row.customer_currency,
        paymentsOnOrBeforeAsOf: Number(row.paid_amount ?? 0),
        paymentsCustomerOnOrBeforeAsOf: Number(row.paid_customer_amount ?? 0),
        reportingBreach: Boolean(row.reporting_breach),
        ctvPaymentTerm: Boolean(row.ctv_payment_term),
        ctvCustomerOverdueMep: Boolean(row.ctv_customer_overdue_mep),
        ctvOutdatedDcl: Boolean(row.ctv_outdated_dcl),
        ctvInvoiceAfterPolicyEnd: Boolean(row.ctv_invoice_after_policy_end),
        inCapacityGap: Boolean(row.in_capacity_gap),
        capacityGapAmount: Number(row.capacity_gap_amount ?? 0),
        actualReportingDate: row.actual_reporting_date,
        lastPaymentDate: row.last_payment_date,
        liveClosed: row.status === "Paid",
        openAmountTolerance,
    };
}

/**
 * Load invoice + payment-ledger rows that could be open as of `asOfDate`.
 * Callers filter to non-zero open via {@link computeAsOfOpenInvoiceLine}
 * (positive AR and open credit notes).
 */
export async function loadAsOfOpenInvoiceCandidates(
    accountId: number,
    asOfDate: Date,
    options?: {
        customerIds?: number[];
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<AsOfOpenInvoiceLine[]> {
    const db = options?.dbClient ?? defaultPrisma;
    const asOf = toUtcDayStart(asOfDate);
    const dayAfter = utcDayAfterExclusive(asOf);
    const customerFilter =
        options?.customerIds != null && options.customerIds.length > 0
            ? Prisma.sql`AND i.customer_id IN (${Prisma.join(options.customerIds)})`
            : Prisma.empty;
    const policyFilter =
        options?.policyId != null
            ? Prisma.sql`AND i.policy_id = ${options.policyId}`
            : Prisma.empty;

    const rows = await db.$queryRaw<AsOfInvoiceSqlRow[]>`
        SELECT
            i.id AS invoice_id,
            i.customer_id,
            i.policy_id,
            i.invoice_date,
            i.due_date,
            i.amount,
            i.customer_amount,
            i.customer_currency,
            COALESCE(p.paid_amount, 0)::float AS paid_amount,
            COALESCE(p.paid_customer_amount, 0)::float AS paid_customer_amount,
            COALESCE(i.reporting_breach, false) AS reporting_breach,
            COALESCE(i.ctv_payment_term, false) AS ctv_payment_term,
            COALESCE(i.ctv_customer_overdue_mep, false) AS ctv_customer_overdue_mep,
            COALESCE(i.ctv_outdated_dcl, false) AS ctv_outdated_dcl,
            COALESCE(i.ctv_invoice_after_policy_end, false) AS ctv_invoice_after_policy_end,
            COALESCE(i.in_capacity_gap, false) AS in_capacity_gap,
            COALESCE(i.capacity_gap_amount, 0)::float AS capacity_gap_amount,
            i.actual_reporting_date,
            p.last_payment_date,
            i.status::text AS status
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        LEFT JOIN LATERAL (
            SELECT
                SUM(
                    CASE
                        WHEN ip.payment_date < ${dayAfter}
                        THEN COALESCE(ip.amount, 0)
                        ELSE 0
                    END
                )::float AS paid_amount,
                SUM(
                    CASE
                        WHEN ip.payment_date < ${dayAfter}
                        THEN COALESCE(ip.customer_amount, 0)
                        ELSE 0
                    END
                )::float AS paid_customer_amount,
                -- True last payment (any day); paid_* sums stay as-of snapshot.
                MAX(ip.payment_date) AS last_payment_date
            FROM "InvoicePayment" ip
            WHERE ip.invoice_id = i.id
              AND ip.account_id = ${accountId}
        ) p ON true
        WHERE i.account_id = ${accountId}
          AND c.account_id = ${accountId}
          AND c.collection_status IN ('Active', 'Inactive')
          AND i.invoice_date <= ${asOf}
          AND i.status::text NOT IN ('Void', 'Cancelled')
          ${customerFilter}
          ${policyFilter}
    `;

    const openAmountTolerance = await resolveInvoicePaidTolerance(
        accountId,
        db
    );
    return rows.map((row) => mapSqlRow(row, openAmountTolerance));
}

function lineMatchesScope(
    line: AsOfOpenInvoiceLine,
    options?: { customerId?: number; policyId?: number | null }
): boolean {
    if (
        options?.customerId != null &&
        line.customerId !== options.customerId
    ) {
        return false;
    }
    if (options?.policyId === undefined) {
        return true;
    }
    if (options.policyId === null) {
        return line.policyId == null;
    }
    return line.policyId === options.policyId;
}

/** Sum as-of open amount from a preloaded ledger (no DB). */
export function sumAsOfOpenAmountFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    options?: { customerId?: number; policyId?: number | null }
): number {
    let total = 0;
    for (const line of lines) {
        if (!lineMatchesScope(line, options)) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        total += computed.openAmount;
    }
    return total;
}

export function sumAsOfOpenAmountByCurrencyFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    currency: string,
    options?: { customerId?: number; policyId?: number | null }
): number {
    const code = currency.trim().toUpperCase();
    if (!code) {
        return 0;
    }
    let total = 0;
    for (const line of lines) {
        if (!lineMatchesScope(line, options)) {
            continue;
        }
        if (line.customerCurrency?.trim().toUpperCase() !== code) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        total +=
            computed.openCustomerAmount > 0
                ? computed.openCustomerAmount
                : computed.openAmount;
    }
    return total;
}

export function resolveAsOfOpenArOnPolicyInLimitCurrencyFromLines(
    lines: AsOfOpenInvoiceLine[],
    customerId: number,
    policyId: number,
    limitCurrency: string,
    accountCurrency: string | null,
    asOfDate: Date
): number {
    const limitCcy = limitCurrency.trim().toUpperCase();
    const acct = accountCurrency?.trim().toUpperCase() ?? "";
    if (limitCcy && acct && limitCcy === acct) {
        return sumAsOfOpenAmountFromLines(lines, asOfDate, {
            customerId,
            policyId,
        });
    }
    return sumAsOfOpenAmountByCurrencyFromLines(lines, asOfDate, limitCcy, {
        customerId,
        policyId,
    });
}

export function sumAsOfTermsBreachFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    options?: {
        customerId?: number;
        policyId?: number | null;
        excludeCapacityGapInvoices?: boolean;
    }
): number {
    let total = 0;
    for (const line of lines) {
        if (!lineMatchesScope(line, options)) {
            continue;
        }
        if (!isTermsBreachLine(line)) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        const open = computed.openAmount;
        total += options?.excludeCapacityGapInvoices
            ? Math.max(0, open - Math.max(0, line.capacityGapAmount ?? 0))
            : open;
    }
    return total;
}

export function buildAsOfOpenReceivableByCustomerMapFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date
): Map<number, number> {
    const map = new Map<number, number>();
    for (const line of lines) {
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        map.set(
            computed.customerId,
            (map.get(computed.customerId) ?? 0) + computed.openAmount
        );
    }
    return map;
}

/** Open as-of breach invoice rows for the existing by-reason aggregator. */
export function asOfTermsBreachInvoicesFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    customerId: number,
    policyId: number | null
): Array<{
    policyId: number | null;
    outstanding: number;
    reportingBreach: boolean;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl: boolean;
    ctvInvoiceAfterPolicyEnd: boolean;
}> {
    const invoices: Array<{
        policyId: number | null;
        outstanding: number;
        reportingBreach: boolean;
        ctvPaymentTerm: boolean;
        ctvCustomerOverdueMep: boolean;
        ctvOutdatedDcl: boolean;
        ctvInvoiceAfterPolicyEnd: boolean;
    }> = [];
    for (const line of lines) {
        if (line.customerId !== customerId) {
            continue;
        }
        if (policyId === null && line.policyId != null) {
            continue;
        }
        if (policyId != null && line.policyId !== policyId) {
            continue;
        }
        if (!isTermsBreachLine(line)) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        invoices.push({
            policyId: computed.policyId,
            outstanding: computed.openAmount,
            reportingBreach: computed.reportingBreach,
            ctvPaymentTerm: computed.ctvPaymentTerm,
            ctvCustomerOverdueMep: computed.ctvCustomerOverdueMep,
            ctvOutdatedDcl: computed.ctvOutdatedDcl,
            ctvInvoiceAfterPolicyEnd: computed.ctvInvoiceAfterPolicyEnd,
        });
    }
    return invoices;
}

/**
 * As-of open invoices for per-invoice at-risk (account-side open amount + gap).
 * Prefer lines already passed through {@link overlayAsOfLiveCapacityGapWaterfallOnLines}.
 * Membership matches live Due/Overdue non-negative lines still open on `asOfDate`.
 */
export function buildAsOfAtRiskInvoiceInputsFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    options?: { customerId?: number; policyId?: number | null }
): CustomerAtRiskInvoiceInput[] {
    const invoices: CustomerAtRiskInvoiceInput[] = [];
    for (const line of lines) {
        if (!lineMatchesScope(line, options)) {
            continue;
        }
        if (isNegativeInvoiceAmount(line.amount)) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        invoices.push({
            outstanding: Math.max(0, computed.openAmount),
            capacityGapAmount: Math.max(0, line.capacityGapAmount ?? 0),
            hasTermsBreach: isTermsBreachLine(line),
        });
    }
    return invoices;
}

/**
 * As-of open at-risk invoice inputs grouped by customer in account currency
 * (same FX path as as-of open AR / terms-breach maps).
 */
export async function buildAsOfAtRiskInvoiceInputsByCustomerInAccountCurrencyFromLines(
    lines: AsOfOpenInvoiceLine[],
    accountCurrency: string,
    asOfDate: Date,
    options?: {
        policyId?: number;
        customerIds?: number[];
    }
): Promise<Map<number, CustomerAtRiskInvoiceInput[]>> {
    const accountCur = accountCurrency.trim().toUpperCase();
    const customerIdSet =
        options?.customerIds != null && options.customerIds.length > 0
            ? new Set(options.customerIds)
            : null;
    const map = new Map<number, CustomerAtRiskInvoiceInput[]>();
    for (const line of lines) {
        if (customerIdSet && !customerIdSet.has(line.customerId)) {
            continue;
        }
        if (
            options?.policyId != null &&
            line.policyId !== options.policyId
        ) {
            continue;
        }
        if (isNegativeInvoiceAmount(line.amount)) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        const synthetic = {
            outstanding_debt: computed.openAmount,
            customer_outstanding_debt: computed.openCustomerAmount,
            amount: computed.openAmount,
            customer_currency: computed.customerCurrency,
        };
        const custCurrency = computed.customerCurrency?.trim().toUpperCase();
        let converted: number | null | undefined;
        const hasAccountOutstanding =
            synthetic.outstanding_debt != null &&
            synthetic.outstanding_debt !== 0;
        if (
            !hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur
        ) {
            const val =
                synthetic.customer_outstanding_debt !== 0
                    ? synthetic.customer_outstanding_debt
                    : synthetic.amount;
            converted = await convertAmountToCurrencyLatestRate(
                custCurrency,
                accountCur,
                val
            );
        }
        const outstanding = Math.max(
            0,
            computeInvoiceLineOpenArInAccountCurrency(
                synthetic,
                accountCur,
                converted
            )
        );
        const bucket = map.get(computed.customerId) ?? [];
        bucket.push({
            outstanding,
            capacityGapAmount: Math.max(0, line.capacityGapAmount ?? 0),
            hasTermsBreach: isTermsBreachLine(line),
        });
        map.set(computed.customerId, bucket);
    }
    return map;
}

export async function fetchAsOfOpenReceivableByCustomerMap(
    accountId: number,
    asOfDate: Date,
    options?: {
        customerIds?: number[];
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<Map<number, number>> {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, options);
    const map = new Map<number, number>();
    for (const line of lines) {
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        map.set(
            computed.customerId,
            (map.get(computed.customerId) ?? 0) + computed.openAmount
        );
    }
    return map;
}

/**
 * As-of open AR per customer in account currency (latest FX when needed).
 */
export async function fetchAsOfOpenReceivableByCustomerMapInAccountCurrency(
    accountId: number,
    accountCurrency: string,
    asOfDate: Date,
    options?: {
        customerIds?: number[];
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<Map<number, number>> {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, options);
    return buildAsOfOpenReceivableByCustomerMapInAccountCurrencyFromLines(
        lines,
        accountCurrency,
        asOfDate,
        options
    );
}

export async function buildAsOfOpenReceivableByCustomerMapInAccountCurrencyFromLines(
    lines: AsOfOpenInvoiceLine[],
    accountCurrency: string,
    asOfDate: Date,
    options?: {
        customerIds?: number[];
        policyId?: number;
    }
): Promise<Map<number, number>> {
    const accountCur = accountCurrency.trim().toUpperCase();
    const customerIdSet =
        options?.customerIds != null && options.customerIds.length > 0
            ? new Set(options.customerIds)
            : null;
    const map = new Map<number, number>();
    for (const line of lines) {
        if (customerIdSet && !customerIdSet.has(line.customerId)) {
            continue;
        }
        if (
            options?.policyId != null &&
            line.policyId !== options.policyId
        ) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        const custCurrency = computed.customerCurrency?.trim().toUpperCase();
        const synthetic = {
            outstanding_debt: computed.openAmount,
            customer_outstanding_debt: computed.openCustomerAmount,
            amount: computed.openAmount,
            customer_currency: computed.customerCurrency,
        };
        let converted: number | null | undefined;
        const hasAccountOutstanding =
            synthetic.outstanding_debt != null &&
            synthetic.outstanding_debt !== 0;
        if (
            !hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur
        ) {
            const val =
                synthetic.customer_outstanding_debt !== 0
                    ? synthetic.customer_outstanding_debt
                    : synthetic.amount;
            converted = await convertAmountToCurrencyLatestRate(
                custCurrency,
                accountCur,
                val
            );
        }
        const lineAmount = computeInvoiceLineOpenArInAccountCurrency(
            synthetic,
            accountCur,
            converted
        );
        map.set(
            computed.customerId,
            (map.get(computed.customerId) ?? 0) + lineAmount
        );
    }
    return map;
}

export async function fetchAsOfOpenReceivableForCustomer(
    accountId: number,
    customerId: number,
    asOfDate: Date,
    policyId?: number | null,
    dbClient?: DbClient
): Promise<number> {
    const map = await fetchAsOfOpenReceivableByCustomerMap(accountId, asOfDate, {
        customerIds: [customerId],
        policyId: policyId ?? undefined,
        dbClient,
    });
    return map.get(customerId) ?? 0;
}

export async function fetchAsOfOpenReceivableForCustomerByCurrency(
    accountId: number,
    customerId: number,
    currency: string,
    asOfDate: Date,
    policyId?: number | null,
    dbClient?: DbClient
): Promise<number> {
    const code = currency.trim().toUpperCase();
    if (!code) {
        return 0;
    }
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, {
        customerIds: [customerId],
        policyId: policyId ?? undefined,
        dbClient,
    });
    let total = 0;
    for (const line of lines) {
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        if (computed.customerCurrency?.trim().toUpperCase() !== code) {
            continue;
        }
        total +=
            computed.openCustomerAmount > 0
                ? computed.openCustomerAmount
                : computed.openAmount;
    }
    return total;
}

export async function resolveAsOfOpenArOnPolicyInLimitCurrency(
    accountId: number,
    customerId: number,
    policyId: number,
    limitCurrency: string,
    accountCurrency: string | null,
    asOfDate: Date,
    dbClient?: DbClient
): Promise<number> {
    const limitCcy = limitCurrency.trim().toUpperCase();
    const acct = accountCurrency?.trim().toUpperCase() ?? "";
    if (limitCcy && acct && limitCcy === acct) {
        return fetchAsOfOpenReceivableForCustomer(
            accountId,
            customerId,
            asOfDate,
            policyId,
            dbClient
        );
    }
    return fetchAsOfOpenReceivableForCustomerByCurrency(
        accountId,
        customerId,
        limitCcy,
        asOfDate,
        policyId,
        dbClient
    );
}

export async function getCustomerAsOfTermsBreachOutstandingSum(
    accountId: number,
    customerId: number,
    asOfDate: Date,
    options?: {
        excludeCapacityGapInvoices?: boolean;
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<number> {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, {
        customerIds: [customerId],
        policyId: options?.policyId,
        dbClient: options?.dbClient,
    });
    let total = 0;
    for (const line of lines) {
        if (!isTermsBreachLine(line)) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        const open = computed.openAmount;
        total += options?.excludeCapacityGapInvoices
            ? Math.max(0, open - Math.max(0, line.capacityGapAmount ?? 0))
            : open;
    }
    return total;
}

export async function getCustomerAsOfTermsBreachOutstandingForAtRisk(
    accountId: number,
    customerId: number,
    asOfDate: Date,
    options?: { policyId?: number; dbClient?: DbClient }
): Promise<number> {
    return getCustomerAsOfTermsBreachOutstandingSum(accountId, customerId, asOfDate, {
        ...options,
        excludeCapacityGapInvoices: true,
    });
}

/**
 * Terms-breach open outstanding per customer in account currency (as-of).
 */
export async function fetchAsOfTermsBreachOutstandingByCustomerInAccountCurrency(
    accountId: number,
    accountCurrency: string,
    asOfDate: Date,
    options?: {
        policyId?: number;
        excludeCapacityGapInvoices?: boolean;
        customerIds?: number[];
        dbClient?: DbClient;
    }
): Promise<Map<number, number>> {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, {
        customerIds: options?.customerIds,
        policyId: options?.policyId,
        dbClient: options?.dbClient,
    });
    return buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines(
        lines,
        accountCurrency,
        asOfDate,
        options
    );
}

export async function buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines(
    lines: AsOfOpenInvoiceLine[],
    accountCurrency: string,
    asOfDate: Date,
    options?: {
        policyId?: number;
        excludeCapacityGapInvoices?: boolean;
        customerIds?: number[];
    }
): Promise<Map<number, number>> {
    const accountCur = accountCurrency.trim().toUpperCase();
    const customerIdSet =
        options?.customerIds != null && options.customerIds.length > 0
            ? new Set(options.customerIds)
            : null;
    const map = new Map<number, number>();
    for (const line of lines) {
        if (customerIdSet && !customerIdSet.has(line.customerId)) {
            continue;
        }
        if (
            options?.policyId != null &&
            line.policyId !== options.policyId
        ) {
            continue;
        }
        if (!isTermsBreachLine(line)) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        const synthetic = {
            outstanding_debt: computed.openAmount,
            customer_outstanding_debt: computed.openCustomerAmount,
            amount: computed.openAmount,
            customer_currency: computed.customerCurrency,
        };
        const custCurrency = computed.customerCurrency?.trim().toUpperCase();
        let converted: number | null | undefined;
        const hasAccountOutstanding =
            synthetic.outstanding_debt != null &&
            synthetic.outstanding_debt !== 0;
        if (
            !hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur
        ) {
            const val =
                synthetic.customer_outstanding_debt !== 0
                    ? synthetic.customer_outstanding_debt
                    : synthetic.amount;
            converted = await convertAmountToCurrencyLatestRate(
                custCurrency,
                accountCur,
                val
            );
        }
        let lineAmount = computeInvoiceLineOpenArInAccountCurrency(
            synthetic,
            accountCur,
            converted
        );
        if (options?.excludeCapacityGapInvoices) {
            lineAmount = Math.max(
                0,
                lineAmount - Math.max(0, line.capacityGapAmount ?? 0)
            );
        }
        map.set(
            computed.customerId,
            (map.get(computed.customerId) ?? 0) + lineAmount
        );
    }
    return map;
}
