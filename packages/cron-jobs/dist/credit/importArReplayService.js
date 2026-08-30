"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareReplayEvents = compareReplayEvents;
exports.sortReplayEvents = sortReplayEvents;
exports.buildReplayEvents = buildReplayEvents;
exports.simulateCustomerArReplay = simulateCustomerArReplay;
exports.getInvoiceGap = getInvoiceGap;
exports.replayCustomerArImport = replayCustomerArImport;
exports.replayArImportForCustomers = replayArImportForCustomers;
/**
 * Chronological AR replay — Nest port of the legacy import AR replay module.
 * Stamps `limit_assessed_amount` in invoice_open / payment_apply date order so
 * capacity-gap sync does not skip null assessments.
 *
 * Does not overwrite `outstanding_debt` / `customer_outstanding_debt` — those
 * stay owned by invoice import and payment recalc (credits keep negative nets).
 */
const billing_connector_1 = require("@archaser/billing-connector");
const credit_insurance_domain_1 = require("@archaser/credit-insurance-domain");
const client_1 = require("@prisma/client");
function calendarDayKey(date) {
    const normalized = (0, credit_insurance_domain_1.parseImportDateToLocalCalendarDate)(date);
    if (!normalized) {
        return date.getTime();
    }
    return (normalized.getFullYear() * 10000 +
        (normalized.getMonth() + 1) * 100 +
        normalized.getDate());
}
/** Same-day tie-break: invoice_open before payment_apply. */
function compareReplayEvents(a, b) {
    const dayCmp = calendarDayKey(a.date) - calendarDayKey(b.date);
    if (dayCmp !== 0) {
        return dayCmp;
    }
    if (a.type === b.type) {
        return 0;
    }
    return a.type === "invoice_open" ? -1 : 1;
}
function sortReplayEvents(events) {
    return [...events].sort(compareReplayEvents);
}
function buildReplayEvents(invoices, payments) {
    const events = [
        ...invoices.map((invoice) => ({
            type: "invoice_open",
            date: invoice.invoiceDate,
            payload: invoice,
        })),
        ...payments.map((payment) => ({
            type: "payment_apply",
            date: payment.paymentDate,
            payload: payment,
        })),
    ];
    return sortReplayEvents(events);
}
function sumOpenAr(invoices) {
    return invoices.reduce((sum, inv) => sum + Math.max(0, inv.outstanding), 0);
}
function gapForInvoice(inv) {
    if (inv.limitAssessedAmount == null) {
        return 0;
    }
    return (0, credit_insurance_domain_1.computeInvoiceCapacityGapContribution)({
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
function simulateCustomerArReplay(config, invoices, payments) {
    const events = buildReplayEvents(invoices, payments);
    const invoiceState = new Map();
    const linkedPaymentIds = new Set();
    let paymentsLinked = 0;
    for (const event of events) {
        if (event.type === "invoice_open") {
            const payload = event.payload;
            const openArBefore = sumOpenAr(Array.from(invoiceState.values()));
            // Limit assessment ignores credit face value; sim outstanding stays signed.
            const assessedOutstanding = Math.max(0, payload.netAmount);
            const limitAssessedAmount = (0, credit_insurance_domain_1.computeLimitAssessedAmountForNewOpenInvoice)({
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
        invoice.customerOutstanding = Math.max(0, invoice.customerOutstanding - payment.customerAmount);
        linkedPaymentIds.add(payment.id);
        paymentsLinked += 1;
    }
    const deferredRemaining = payments.filter((p) => !linkedPaymentIds.has(p.id)).length;
    return {
        summary: {
            eventsApplied: events.length,
            paymentsLinked,
            deferredRemaining,
        },
        invoices: Array.from(invoiceState.values()),
    };
}
function getInvoiceGap(inv) {
    return gapForInvoice(inv);
}
/**
 * DB-backed replay for a single customer. Links deferred payments on
 * payment_apply events and re-stamps limit_assessed_amount on invoice_open.
 * Does not rewrite outstanding columns (import / payment recalc own those).
 */
async function replayCustomerArImport(params) {
    const db = params.dbClient ?? credit_insurance_domain_1.creditInsurancePrisma;
    const customerId = params.customerId;
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
    const invoiceInputs = params.invoices ??
        dbInvoices
            .filter((inv) => inv.invoice_number && inv.invoice_date)
            .map((inv) => ({
            invoiceNumber: inv.invoice_number,
            invoiceDate: inv.invoice_date,
            netAmount: inv.net_amount ?? 0,
            customerNetAmount: inv.customer_net_amount ?? 0,
            invoiceId: inv.id,
        }));
    const paymentInputs = params.payments ??
        dbPayments
            .filter((p) => p.invoice_number)
            .map((p) => ({
            id: p.id,
            invoiceNumber: p.invoice_number,
            paymentDate: p.payment_date,
            amount: p.amount,
            customerAmount: p.customer_amount,
            invoiceId: p.invoice_id,
        }));
    const baseApprovedLimit = params.approvedLimit != null
        ? new client_1.Prisma.Decimal(params.approvedLimit)
        : (insurance?.approved_limit ?? null);
    const approvedLimit = baseApprovedLimit != null
        ? new client_1.Prisma.Decimal(baseApprovedLimit).toNumber()
        : 0;
    const limitCurrency = (params.approvedLimitCurrency ?? insurance?.approved_limit_currency)
        ?.trim()
        .toUpperCase() || null;
    // Top-ups carry start/end dates, so each invoice is assessed against the
    // top-ups live on its own issue date. The base approved limit has no
    // history, so it stays the current value.
    const topUpTotalByDay = new Map();
    const resolveTopUpTotalAsOf = async (asOfDate) => {
        if (params.topUpTotal != null) {
            return params.topUpTotal;
        }
        if (baseApprovedLimit == null) {
            return 0;
        }
        const dayKey = calendarDayKey(asOfDate);
        const cached = topUpTotalByDay.get(dayKey);
        if (cached != null) {
            return cached;
        }
        const resolved = await (0, credit_insurance_domain_1.resolveEffectiveApprovedLimit)(customerId, {
            asOfDate,
            baseApprovedLimit,
            baseApprovedLimitCurrency: limitCurrency,
            outdatedDcl: insurance?.outdated_dcl ?? false,
            excludedFromPolicy: insurance?.excluded_from_policy ?? false,
            ...(insurance?.insurance_policy_id != null
                ? { parentPrimaryPolicyId: insurance.insurance_policy_id }
                : {}),
            dbClient: db,
        });
        topUpTotalByDay.set(dayKey, resolved.topUpTotalInLimitCurrency);
        return resolved.topUpTotalInLimitCurrency;
    };
    const events = buildReplayEvents(invoiceInputs, paymentInputs);
    const invoiceIdByNumber = new Map(invoiceInputs
        .filter((inv) => inv.invoiceId != null)
        .map((inv) => [inv.invoiceNumber, inv.invoiceId]));
    let paymentsLinked = 0;
    let deferredRemaining = 0;
    // Point-in-time open AR: invoices add to it when they open and give the
    // headroom back as payments are applied along the timeline. Reading current
    // AR from the DB here would leak present-day (already paid) balances into
    // past events, permanently locking the limit inside closed invoices.
    const openArRunning = new Map();
    const openOutstandingByInvoice = new Map();
    let eventsProcessed = 0;
    for (const event of events) {
        eventsProcessed += 1;
        if (eventsProcessed % 100 === 0 || eventsProcessed === events.length) {
            params.onProgress?.({
                processed: eventsProcessed,
                total: events.length,
            });
        }
        if (event.type === "invoice_open") {
            const payload = event.payload;
            const scopeKey = "default";
            const openBefore = openArRunning.get(scopeKey) ?? 0;
            // Credits (negative net) must not consume limit or be written as 0 outstanding.
            const assessedOutstanding = Math.max(0, payload.netAmount);
            const limitAssessedAmount = (0, credit_insurance_domain_1.computeLimitAssessedAmountForNewOpenInvoice)({
                approvedLimit,
                topUpTotal: await resolveTopUpTotalAsOf(payload.invoiceDate),
                openArOnPolicyBeforeInvoice: openBefore,
                newInvoiceOutstanding: assessedOutstanding,
            });
            if (payload.invoiceId != null) {
                await db.invoice.update({
                    where: { id: payload.invoiceId },
                    data: {
                        limit_assessed_amount: limitAssessedAmount,
                        limit_assessed_currency: limitCurrency,
                        limit_assessed_at: new Date(),
                    },
                });
                await (0, credit_insurance_domain_1.stampInvoiceInsuranceFieldsAsOf)(payload.invoiceId, payload.invoiceDate, db);
            }
            openArRunning.set(scopeKey, openBefore + assessedOutstanding);
            openOutstandingByInvoice.set(payload.invoiceNumber, (openOutstandingByInvoice.get(payload.invoiceNumber) ?? 0) +
                assessedOutstanding);
            if (payload.invoiceId != null) {
                invoiceIdByNumber.set(payload.invoiceNumber, payload.invoiceId);
            }
            continue;
        }
        const payment = event.payload;
        const invoiceId = payment.invoiceId ??
            invoiceIdByNumber.get(payment.invoiceNumber) ??
            (await db.invoice.findFirst({
                where: {
                    customer_id: customerId,
                    invoice_number: payment.invoiceNumber,
                },
                select: { id: true },
            }))?.id;
        if (invoiceId == null) {
            deferredRemaining += 1;
            continue;
        }
        invoiceIdByNumber.set(payment.invoiceNumber, invoiceId);
        const linkResult = await (0, billing_connector_1.linkDeferredPaymentAndRecalc)(db, {
            invoicePaymentId: payment.id,
            invoiceId,
            forceRecalc: true,
        });
        if (!linkResult.alreadyLinked) {
            paymentsLinked += 1;
        }
        const scopeKey = "default";
        const openOnInvoice = openOutstandingByInvoice.get(payment.invoiceNumber) ?? 0;
        const applied = Math.min(openOnInvoice, Math.max(0, payment.amount));
        if (applied > 0) {
            openOutstandingByInvoice.set(payment.invoiceNumber, openOnInvoice - applied);
            openArRunning.set(scopeKey, Math.max(0, (openArRunning.get(scopeKey) ?? 0) - applied));
        }
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
async function replayArImportForCustomers(customerIds, accountId, dbClient) {
    const perCustomer = [];
    for (const customerId of customerIds) {
        perCustomer.push(await replayCustomerArImport({
            customerId,
            accountId,
            dbClient,
        }));
    }
    return {
        customersAffected: perCustomer.length,
        eventsApplied: perCustomer.reduce((s, c) => s + c.eventsApplied, 0),
        paymentsLinked: perCustomer.reduce((s, c) => s + c.paymentsLinked, 0),
        deferredRemaining: perCustomer.reduce((s, c) => s + c.deferredRemaining, 0),
        perCustomer,
    };
}
