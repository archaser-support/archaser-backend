"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASOF_OPEN_AR_EXCLUDED_STATUSES = void 0;
exports.preferAmountPair = preferAmountPair;
exports.computeAsOfOpenAmount = computeAsOfOpenAmount;
exports.classifyAsOfOpenStatus = classifyAsOfOpenStatus;
exports.toUtcDayStart = toUtcDayStart;
exports.utcDayAfterExclusive = utcDayAfterExclusive;
exports.asOfCapacityGapAmount = asOfCapacityGapAmount;
exports.wasAsOfInvoiceOpenAt = wasAsOfInvoiceOpenAt;
exports.asOfCustomerOverdueBlockAt = asOfCustomerOverdueBlockAt;
exports.overlayAsOfTermsFlagsOnLine = overlayAsOfTermsFlagsOnLine;
exports.overlayAsOfTermsFlagsOnLines = overlayAsOfTermsFlagsOnLines;
exports.withReportingBreachIgnored = withReportingBreachIgnored;
exports.asOfTermsScopeKey = asOfTermsScopeKey;
exports.computeAsOfOpenInvoiceLine = computeAsOfOpenInvoiceLine;
exports.loadAsOfOpenInvoiceCandidates = loadAsOfOpenInvoiceCandidates;
exports.sumAsOfOpenAmountFromLines = sumAsOfOpenAmountFromLines;
exports.sumAsOfOpenAmountByCurrencyFromLines = sumAsOfOpenAmountByCurrencyFromLines;
exports.resolveAsOfOpenArOnPolicyInLimitCurrencyFromLines = resolveAsOfOpenArOnPolicyInLimitCurrencyFromLines;
exports.sumAsOfTermsBreachFromLines = sumAsOfTermsBreachFromLines;
exports.buildAsOfOpenReceivableByCustomerMapFromLines = buildAsOfOpenReceivableByCustomerMapFromLines;
exports.asOfTermsBreachInvoicesFromLines = asOfTermsBreachInvoicesFromLines;
exports.fetchAsOfOpenReceivableByCustomerMap = fetchAsOfOpenReceivableByCustomerMap;
exports.fetchAsOfOpenReceivableByCustomerMapInAccountCurrency = fetchAsOfOpenReceivableByCustomerMapInAccountCurrency;
exports.buildAsOfOpenReceivableByCustomerMapInAccountCurrencyFromLines = buildAsOfOpenReceivableByCustomerMapInAccountCurrencyFromLines;
exports.fetchAsOfOpenReceivableForCustomer = fetchAsOfOpenReceivableForCustomer;
exports.fetchAsOfOpenReceivableForCustomerByCurrency = fetchAsOfOpenReceivableForCustomerByCurrency;
exports.resolveAsOfOpenArOnPolicyInLimitCurrency = resolveAsOfOpenArOnPolicyInLimitCurrency;
exports.getCustomerAsOfTermsBreachOutstandingSum = getCustomerAsOfTermsBreachOutstandingSum;
exports.getCustomerAsOfTermsBreachOutstandingForAtRisk = getCustomerAsOfTermsBreachOutstandingForAtRisk;
exports.fetchAsOfTermsBreachOutstandingByCustomerInAccountCurrency = fetchAsOfTermsBreachOutstandingByCustomerInAccountCurrency;
exports.buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines = buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines;
const client_1 = require("@prisma/client");
const domain_db_1 = require("../domain-db");
const customerCreditInsuranceHeaderAmounts_1 = require("./customerCreditInsuranceHeaderAmounts");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
const openReceivableByCustomerCurrency_1 = require("./openReceivableByCustomerCurrency");
/** Invoice statuses excluded from as-of open AR (cancelled / void book). */
exports.ASOF_OPEN_AR_EXCLUDED_STATUSES = ["Void", "Cancelled"];
/**
 * Prefer primary amount when non-zero, else customer amount — same COALESCE
 * spirit as live open-AR line outstanding.
 */
function preferAmountPair(pair) {
    const primary = Number(pair.amount ?? 0);
    if (primary !== 0) {
        return primary;
    }
    return Number(pair.customerAmount ?? 0);
}
/**
 * Payment-ledger open amount as of day D: max(0, original − payments on/before D).
 */
function computeAsOfOpenAmount(original, paymentsOnOrBeforeAsOf) {
    const open = Number(original) - Number(paymentsOnOrBeforeAsOf);
    if (!Number.isFinite(open) || open <= 0) {
        return 0;
    }
    return open;
}
/**
 * Classify remaining open balance vs due date on as-of day D (UTC calendar).
 */
function classifyAsOfOpenStatus(dueDate, asOfDate) {
    if (!dueDate) {
        return "Due";
    }
    const due = toUtcDayStart(dueDate);
    const asOf = toUtcDayStart(asOfDate);
    return due.getTime() < asOf.getTime() ? "Overdue" : "Due";
}
function toUtcDayStart(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
/** Exclusive upper bound: first UTC instant after as-of calendar day. */
function utcDayAfterExclusive(asOfDate) {
    const next = toUtcDayStart(asOfDate);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
}
/**
 * Over-limit slice as of the snapshot day. Outdated DCL suppresses the gap
 * (same rule as live capacity-gap computation).
 */
function asOfCapacityGapAmount(totalReceivables, effectiveApprovedLimit, outdatedDcl) {
    if (outdatedDcl) {
        return 0;
    }
    return (0, invoiceInsuranceFields_1.computeLimitExcessOverEffective)(totalReceivables, effectiveApprovedLimit);
}
/**
 * Whether `line` still had open AR on calendar day `atDate`.
 * Snapshot payment totals are as-of the load day; lastPaymentDate reconstructs
 * invoices that were later paid.
 */
function wasAsOfInvoiceOpenAt(line, atDate) {
    const at = toUtcDayStart(atDate);
    if (toUtcDayStart(line.invoiceDate).getTime() > at.getTime()) {
        return false;
    }
    const original = preferAmountPair({
        amount: line.amount,
        customerAmount: line.customerAmount,
    });
    const paidAsOfLoad = preferAmountPair({
        amount: line.paymentsOnOrBeforeAsOf,
        customerAmount: line.paymentsCustomerOnOrBeforeAsOf,
    });
    if (computeAsOfOpenAmount(original, paidAsOfLoad) > 0) {
        return true;
    }
    if (paidAsOfLoad <= 0) {
        return original > 0;
    }
    if (!line.lastPaymentDate) {
        return false;
    }
    return toUtcDayStart(line.lastPaymentDate).getTime() > at.getTime();
}
/**
 * Customer overdue_block as of `atDate`: oldest overdue due among invoices
 * still open that day, plus max allowed MEP.
 */
function asOfCustomerOverdueBlockAt(customerLines, atDate, maxAllowedMep) {
    let oldestOverdueDue = null;
    for (const line of customerLines) {
        if (!wasAsOfInvoiceOpenAt(line, atDate)) {
            continue;
        }
        if (classifyAsOfOpenStatus(line.dueDate, atDate) !== "Overdue") {
            continue;
        }
        if (!line.dueDate) {
            continue;
        }
        const due = toUtcDayStart(line.dueDate);
        if (!oldestOverdueDue || due.getTime() < oldestOverdueDue.getTime()) {
            oldestOverdueDue = due;
        }
    }
    return (0, invoiceInsuranceFields_1.computeCustomerOverdueBlock)({
        oldestInvoiceOverdueDate: oldestOverdueDue,
        maxAllowedMepDays: maxAllowedMep,
        today: atDate,
    });
}
/**
 * Recompute terms-breach flags for an as-of-open invoice from policy terms and
 * the snapshot calendar day. MEP is created-in-violation: true when the
 * customer overdue block was already on at this invoice's issue date.
 */
function overlayAsOfTermsFlagsOnLine(line, asOfDate, terms, options) {
    const asOfStatus = classifyAsOfOpenStatus(line.dueDate, asOfDate);
    const row = (0, invoiceInsuranceFields_1.computeInvoiceInsuranceRowData)({
        status: asOfStatus,
        invoice_date: line.invoiceDate,
        due_date: line.dueDate,
        actual_reporting_date: line.actualReportingDate ?? null,
        customer: {
            reporting_days: terms.reportingDays,
            max_allowed_mep: terms.maxAllowedMep,
            max_payment_term: terms.maxPaymentTerm,
            mep_cutoff_day_of_month: terms.mepCutoffDayOfMonth,
            mep_substitute_day_of_month: terms.mepSubstituteDayOfMonth,
            reporting_cutoff_day_of_month: terms.reportingCutoffDayOfMonth,
            reporting_substitute_day_of_month: terms.reportingSubstituteDayOfMonth,
            payment_term_cutoff_day_of_month: terms.paymentTermCutoffDayOfMonth,
            payment_term_substitute_day_of_month: terms.paymentTermSubstituteDayOfMonth,
        },
        today: asOfDate,
    });
    const siblingLines = options?.siblingLines ?? [line];
    const ctvCustomerOverdueMep = asOfCustomerOverdueBlockAt(siblingLines, line.invoiceDate, terms.maxAllowedMep);
    return {
        ...line,
        reportingBreach: options?.ignoreReportingBreach
            ? false
            : row.reporting_breach,
        ctvPaymentTerm: row.ctv_payment_term,
        ctvCustomerOverdueMep,
        ctvInvoiceAfterPolicyEnd: terms.policyEndDate
            ? (0, invoiceInsuranceFields_1.computeCreatedTermsViolationInvoiceAfterPolicyEnd)(line.invoiceDate, terms.policyEndDate)
            : line.ctvInvoiceAfterPolicyEnd,
    };
}
function overlayAsOfTermsFlagsOnLines(lines, asOfDate, termsByCustomerAndPolicy, options) {
    const linesByCustomer = new Map();
    for (const line of lines) {
        const bucket = linesByCustomer.get(line.customerId) ?? [];
        bucket.push(line);
        linesByCustomer.set(line.customerId, bucket);
    }
    return lines.map((line) => {
        const exact = termsByCustomerAndPolicy.get(`${line.customerId}:${line.policyId ?? "none"}`);
        const fallback = termsByCustomerAndPolicy.get(`${line.customerId}:none`);
        const terms = exact ?? fallback;
        if (!terms) {
            if (options?.ignoreReportingBreach) {
                return { ...line, reportingBreach: false };
            }
            return line;
        }
        return overlayAsOfTermsFlagsOnLine(line, asOfDate, terms, {
            siblingLines: linesByCustomer.get(line.customerId) ?? [line],
            ignoreReportingBreach: options?.ignoreReportingBreach,
        });
    });
}
/** Force reporting-late off on ledger lines (dashboard snapshot path). */
function withReportingBreachIgnored(lines, ignoreReportingBreach) {
    if (!ignoreReportingBreach) {
        return lines;
    }
    return lines.map((line) => ({ ...line, reportingBreach: false }));
}
function asOfTermsScopeKey(customerId, policyId) {
    return `${customerId}:${policyId ?? "none"}`;
}
function computeAsOfOpenInvoiceLine(line, asOfDate) {
    const openAmount = computeAsOfOpenAmount(preferAmountPair({
        amount: line.amount,
        customerAmount: line.customerAmount,
    }), preferAmountPair({
        amount: line.paymentsOnOrBeforeAsOf,
        customerAmount: line.paymentsCustomerOnOrBeforeAsOf,
    }));
    if (openAmount <= 0) {
        return null;
    }
    const openCustomerAmount = computeAsOfOpenAmount(Number(line.customerAmount ?? 0) || Number(line.amount ?? 0), Number(line.paymentsCustomerOnOrBeforeAsOf ?? 0) ||
        Number(line.paymentsOnOrBeforeAsOf ?? 0));
    return {
        ...line,
        openAmount,
        openCustomerAmount,
        status: classifyAsOfOpenStatus(line.dueDate, asOfDate),
    };
}
function isTermsBreachLine(line) {
    return (line.reportingBreach ||
        line.ctvPaymentTerm ||
        line.ctvCustomerOverdueMep ||
        line.ctvOutdatedDcl ||
        line.ctvInvoiceAfterPolicyEnd);
}
function mapSqlRow(row) {
    return {
        invoiceId: Number(row.invoice_id),
        customerId: Number(row.customer_id),
        policyId: row.policy_id != null ? Number(row.policy_id) : null,
        invoiceDate: row.invoice_date,
        dueDate: row.due_date,
        amount: row.amount != null ? Number(row.amount) : null,
        customerAmount: row.customer_amount != null ? Number(row.customer_amount) : null,
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
    };
}
/**
 * Load invoice + payment-ledger rows that could be open as of `asOfDate`.
 * Callers filter to open &gt; 0 via {@link computeAsOfOpenInvoiceLine}.
 */
async function loadAsOfOpenInvoiceCandidates(accountId, asOfDate, options) {
    const db = options?.dbClient ?? domain_db_1.prisma;
    const asOf = toUtcDayStart(asOfDate);
    const dayAfter = utcDayAfterExclusive(asOf);
    const customerFilter = options?.customerIds != null && options.customerIds.length > 0
        ? client_1.Prisma.sql `AND i.customer_id IN (${client_1.Prisma.join(options.customerIds)})`
        : client_1.Prisma.empty;
    const policyFilter = options?.policyId != null
        ? client_1.Prisma.sql `AND i.policy_id = ${options.policyId}`
        : client_1.Prisma.empty;
    const rows = await db.$queryRaw `
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
            p.last_payment_date
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        LEFT JOIN LATERAL (
            SELECT
                SUM(COALESCE(ip.amount, 0))::float AS paid_amount,
                SUM(COALESCE(ip.customer_amount, 0))::float AS paid_customer_amount,
                MAX(ip.payment_date) AS last_payment_date
            FROM "InvoicePayment" ip
            WHERE ip.invoice_id = i.id
              AND ip.account_id = ${accountId}
              AND ip.payment_date < ${dayAfter}
        ) p ON true
        WHERE i.account_id = ${accountId}
          AND c.account_id = ${accountId}
          AND c.collection_status IN ('Active', 'Inactive')
          AND i.invoice_date <= ${asOf}
          AND i.status::text NOT IN ('Void', 'Cancelled')
          ${customerFilter}
          ${policyFilter}
    `;
    return rows.map(mapSqlRow);
}
function lineMatchesScope(line, options) {
    if (options?.customerId != null &&
        line.customerId !== options.customerId) {
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
function sumAsOfOpenAmountFromLines(lines, asOfDate, options) {
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
function sumAsOfOpenAmountByCurrencyFromLines(lines, asOfDate, currency, options) {
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
function resolveAsOfOpenArOnPolicyInLimitCurrencyFromLines(lines, customerId, policyId, limitCurrency, accountCurrency, asOfDate) {
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
function sumAsOfTermsBreachFromLines(lines, asOfDate, options) {
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
function buildAsOfOpenReceivableByCustomerMapFromLines(lines, asOfDate) {
    const map = new Map();
    for (const line of lines) {
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        map.set(computed.customerId, (map.get(computed.customerId) ?? 0) + computed.openAmount);
    }
    return map;
}
/** Open as-of breach invoice rows for the existing by-reason aggregator. */
function asOfTermsBreachInvoicesFromLines(lines, asOfDate, customerId, policyId) {
    const invoices = [];
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
async function fetchAsOfOpenReceivableByCustomerMap(accountId, asOfDate, options) {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, options);
    const map = new Map();
    for (const line of lines) {
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        map.set(computed.customerId, (map.get(computed.customerId) ?? 0) + computed.openAmount);
    }
    return map;
}
/**
 * As-of open AR per customer in account currency (latest FX when needed).
 */
async function fetchAsOfOpenReceivableByCustomerMapInAccountCurrency(accountId, accountCurrency, asOfDate, options) {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, options);
    return buildAsOfOpenReceivableByCustomerMapInAccountCurrencyFromLines(lines, accountCurrency, asOfDate, options);
}
async function buildAsOfOpenReceivableByCustomerMapInAccountCurrencyFromLines(lines, accountCurrency, asOfDate, options) {
    const accountCur = accountCurrency.trim().toUpperCase();
    const customerIdSet = options?.customerIds != null && options.customerIds.length > 0
        ? new Set(options.customerIds)
        : null;
    const map = new Map();
    for (const line of lines) {
        if (customerIdSet && !customerIdSet.has(line.customerId)) {
            continue;
        }
        if (options?.policyId != null &&
            line.policyId !== options.policyId) {
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
        let converted;
        const hasAccountOutstanding = synthetic.outstanding_debt != null &&
            synthetic.outstanding_debt !== 0;
        if (!hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur) {
            const val = synthetic.customer_outstanding_debt !== 0
                ? synthetic.customer_outstanding_debt
                : synthetic.amount;
            converted = await (0, customerCreditInsuranceHeaderAmounts_1.convertAmountToCurrencyLatestRate)(custCurrency, accountCur, val);
        }
        const lineAmount = (0, openReceivableByCustomerCurrency_1.computeInvoiceLineOpenArInAccountCurrency)(synthetic, accountCur, converted);
        map.set(computed.customerId, (map.get(computed.customerId) ?? 0) + lineAmount);
    }
    return map;
}
async function fetchAsOfOpenReceivableForCustomer(accountId, customerId, asOfDate, policyId, dbClient) {
    const map = await fetchAsOfOpenReceivableByCustomerMap(accountId, asOfDate, {
        customerIds: [customerId],
        policyId: policyId ?? undefined,
        dbClient,
    });
    return map.get(customerId) ?? 0;
}
async function fetchAsOfOpenReceivableForCustomerByCurrency(accountId, customerId, currency, asOfDate, policyId, dbClient) {
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
async function resolveAsOfOpenArOnPolicyInLimitCurrency(accountId, customerId, policyId, limitCurrency, accountCurrency, asOfDate, dbClient) {
    const limitCcy = limitCurrency.trim().toUpperCase();
    const acct = accountCurrency?.trim().toUpperCase() ?? "";
    if (limitCcy && acct && limitCcy === acct) {
        return fetchAsOfOpenReceivableForCustomer(accountId, customerId, asOfDate, policyId, dbClient);
    }
    return fetchAsOfOpenReceivableForCustomerByCurrency(accountId, customerId, limitCcy, asOfDate, policyId, dbClient);
}
async function getCustomerAsOfTermsBreachOutstandingSum(accountId, customerId, asOfDate, options) {
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
async function getCustomerAsOfTermsBreachOutstandingForAtRisk(accountId, customerId, asOfDate, options) {
    return getCustomerAsOfTermsBreachOutstandingSum(accountId, customerId, asOfDate, {
        ...options,
        excludeCapacityGapInvoices: true,
    });
}
/**
 * Terms-breach open outstanding per customer in account currency (as-of).
 */
async function fetchAsOfTermsBreachOutstandingByCustomerInAccountCurrency(accountId, accountCurrency, asOfDate, options) {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, {
        customerIds: options?.customerIds,
        policyId: options?.policyId,
        dbClient: options?.dbClient,
    });
    return buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines(lines, accountCurrency, asOfDate, options);
}
async function buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines(lines, accountCurrency, asOfDate, options) {
    const accountCur = accountCurrency.trim().toUpperCase();
    const customerIdSet = options?.customerIds != null && options.customerIds.length > 0
        ? new Set(options.customerIds)
        : null;
    const map = new Map();
    for (const line of lines) {
        if (customerIdSet && !customerIdSet.has(line.customerId)) {
            continue;
        }
        if (options?.policyId != null &&
            line.policyId !== options.policyId) {
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
        let converted;
        const hasAccountOutstanding = synthetic.outstanding_debt != null &&
            synthetic.outstanding_debt !== 0;
        if (!hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur) {
            const val = synthetic.customer_outstanding_debt !== 0
                ? synthetic.customer_outstanding_debt
                : synthetic.amount;
            converted = await (0, customerCreditInsuranceHeaderAmounts_1.convertAmountToCurrencyLatestRate)(custCurrency, accountCur, val);
        }
        let lineAmount = (0, openReceivableByCustomerCurrency_1.computeInvoiceLineOpenArInAccountCurrency)(synthetic, accountCur, converted);
        if (options?.excludeCapacityGapInvoices) {
            lineAmount = Math.max(0, lineAmount - Math.max(0, line.capacityGapAmount ?? 0));
        }
        map.set(computed.customerId, (map.get(computed.customerId) ?? 0) + lineAmount);
    }
    return map;
}
