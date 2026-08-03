"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncInvoiceReportingBreach = syncInvoiceReportingBreach;
exports.clearReportingBreachWhenReportedForInvoiceIds = clearReportingBreachWhenReportedForInvoiceIds;
exports.sweepReportingBreachForOverdueInvoiceIds = sweepReportingBreachForOverdueInvoiceIds;
exports.refreshInsuranceTargetDatesForInvoiceIds = refreshInsuranceTargetDatesForInvoiceIds;
exports.refreshPaymentTermBreachForInvoiceIds = refreshPaymentTermBreachForInvoiceIds;
exports.refreshCtvSnapshotsForInvoiceIds = refreshCtvSnapshotsForInvoiceIds;
exports.clearCustomerExcludedFromPolicyFlagWhenIncluded = clearCustomerExcludedFromPolicyFlagWhenIncluded;
exports.refreshTermsBreachFlagsForCustomer = refreshTermsBreachFlagsForCustomer;
const domain_db_1 = require("../domain-db");
const loadEffectiveInsuranceForCustomers_1 = require("./loadEffectiveInsuranceForCustomers");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
function datesEqualCalendarUtc(a, b) {
    if (a == null && b == null) {
        return true;
    }
    if (a == null || b == null) {
        return false;
    }
    return (0, invoiceInsuranceFields_1.startOfUtcDay)(a).getTime() === (0, invoiceInsuranceFields_1.startOfUtcDay)(b).getTime();
}
/**
 * Sets Invoice.reporting_breach to true when Due/Overdue, target reporting date &lt; today,
 * and no actual_reporting_date. Sets to false only when actual_reporting_date is set.
 * Does not clear reporting_breach on Paid/Cancelled alone.
 */
async function syncInvoiceReportingBreach(invoiceId, db = domain_db_1.prisma) {
    const inv = await db.invoice.findUnique({
        where: { id: invoiceId },
        select: {
            id: true,
            status: true,
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
    const should = (0, invoiceInsuranceFields_1.shouldSetReportingBreach)(inv.status, inv.target_reporting_date, inv.actual_reporting_date, today);
    if (should && !inv.reporting_breach) {
        await db.invoice.update({
            where: { id: invoiceId },
            data: { reporting_breach: true },
        });
    }
}
/**
 * When reporting was filed (actual date set), clear reporting_breach for IDs in this batch.
 * Matches {@link syncInvoiceReportingBreach} clearing rules.
 */
async function clearReportingBreachWhenReportedForInvoiceIds(invoiceIds, db = domain_db_1.prisma) {
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
async function sweepReportingBreachForOverdueInvoiceIds(invoiceIds, db = domain_db_1.prisma) {
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
        },
        select: {
            id: true,
            status: true,
            target_reporting_date: true,
        },
    });
    let n = 0;
    for (const inv of invoices) {
        if (!inv.target_reporting_date) {
            continue;
        }
        const should = (0, invoiceInsuranceFields_1.shouldSetReportingBreach)(inv.status, inv.target_reporting_date, null, today);
        if (should) {
            await db.invoice.update({
                where: { id: inv.id },
                data: { reporting_breach: true },
            });
            n += 1;
        }
    }
    return n;
}
/**
 * Recompute target_reporting_date and target_mep_date from invoice due_date and
 * Customer.reporting_days / max_allowed_mep (same as import / refreshInsuranceFields).
 */
async function refreshInsuranceTargetDatesForInvoiceIds(invoiceIds, db = domain_db_1.prisma) {
    if (invoiceIds.length === 0) {
        return 0;
    }
    const rows = await db.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: {
            id: true,
            invoice_date: true,
            due_date: true,
            target_reporting_date: true,
            target_mep_date: true,
            customer_id: true,
        },
    });
    const customerIds = Array.from(new Set(rows
        .map((r) => r.customer_id)
        .filter((id) => id != null)));
    if (customerIds.length === 0) {
        return 0;
    }
    const customerById = await (0, loadEffectiveInsuranceForCustomers_1.loadEffectiveInsuranceForCustomers)(customerIds);
    let updated = 0;
    for (const inv of rows) {
        if (inv.customer_id == null) {
            continue;
        }
        const c = customerById.get(inv.customer_id);
        const nextReporting = (0, invoiceInsuranceFields_1.computeTargetReportingDate)(inv.due_date, c?.reporting_days ?? null, {
            invoiceDate: inv.invoice_date,
            cutoffDayOfMonth: c?.reporting_cutoff_day_of_month ?? null,
            substituteDayOfMonth: c?.reporting_substitute_day_of_month ?? null,
        });
        const nextMep = (0, invoiceInsuranceFields_1.computeTargetMepDate)(inv.due_date, c?.max_allowed_mep ?? null, {
            invoiceDate: inv.invoice_date,
            cutoffDayOfMonth: c?.mep_cutoff_day_of_month ?? null,
            substituteDayOfMonth: c?.mep_substitute_day_of_month ?? null,
        });
        const reportingChanged = !datesEqualCalendarUtc(inv.target_reporting_date, nextReporting);
        const mepChanged = !datesEqualCalendarUtc(inv.target_mep_date, nextMep);
        if (!reportingChanged && !mepChanged) {
            continue;
        }
        await db.invoice.update({
            where: { id: inv.id },
            data: {
                target_reporting_date: nextReporting,
                target_mep_date: nextMep,
            },
        });
        updated += 1;
    }
    return updated;
}
/**
 * Recompute ctv_payment_term from invoice dates and Customer.max_payment_term (batch / cron).
 */
async function refreshPaymentTermBreachForInvoiceIds(invoiceIds, db = domain_db_1.prisma) {
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
    const customerIds = Array.from(new Set(rows
        .map((r) => r.customer_id)
        .filter((id) => id != null)));
    if (customerIds.length === 0) {
        return 0;
    }
    const insuranceByCustomerId = await (0, loadEffectiveInsuranceForCustomers_1.loadEffectiveInsuranceForCustomers)(customerIds);
    let updated = 0;
    for (const inv of rows) {
        if (inv.customer_id == null) {
            continue;
        }
        const customerCtx = insuranceByCustomerId.get(inv.customer_id);
        const next = (0, invoiceInsuranceFields_1.computePaymentTermBreach)(inv.invoice_date, inv.due_date, customerCtx?.max_payment_term ?? null, {
            invoiceDate: inv.invoice_date,
            cutoffDayOfMonth: customerCtx?.payment_term_cutoff_day_of_month ?? null,
            substituteDayOfMonth: customerCtx?.payment_term_substitute_day_of_month ?? null,
        });
        if (next !== inv.ctv_payment_term) {
            await db.invoice.update({
                where: { id: inv.id },
                data: { ctv_payment_term: next },
            });
            updated += 1;
        }
    }
    return updated;
}
const CTV_SNAPSHOT_UPDATE_CONCURRENCY = 24;
async function runWithConcurrency(items, limit, fn) {
    if (items.length === 0) {
        return;
    }
    let cursor = 0;
    async function worker() {
        for (;;) {
            const i = cursor++;
            if (i >= items.length) {
                return;
            }
            await fn(items[i]);
        }
    }
    const workerCount = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
/**
 * Recompute created-terms violation snapshot booleans from current Customer + InsurancePolicy rows.
 * Uses batched reads + parallel updates (for cron/post-import sweep; avoids N sequential full-service refreshes).
 */
async function refreshCtvSnapshotsForInvoiceIds(invoiceIds, db = domain_db_1.prisma) {
    if (invoiceIds.length === 0) {
        return 0;
    }
    const rows = await db.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: {
            id: true,
            invoice_date: true,
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
                        },
                    },
                },
            },
        },
    });
    const policyIds = Array.from(new Set(rows
        .map((r) => r.Customer?.CustomerPolicy?.[0]?.insurance_policy_id)
        .filter((id) => id != null)));
    const policies = policyIds.length === 0
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
    const pending = [];
    for (const inv of rows) {
        if (!inv.Customer) {
            continue;
        }
        const activePolicy = inv.Customer.CustomerPolicy?.[0];
        const cid = activePolicy?.insurance_policy_id ?? null;
        const policyRow = cid != null ? policyById.get(cid) ?? null : null;
        const snap = (0, invoiceInsuranceFields_1.computeCreatedTermsViolationSnapshot)({
            invoice_date: inv.invoice_date,
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
                    score_validity_period_months: policyRow.score_validity_period_months,
                    min_credit_score: policyRow.min_credit_score,
                    dcl_customer_since_months: policyRow.dcl_customer_since_months,
                }
                : null,
        });
        const unchanged = snap.ctv_customer_overdue_mep === inv.ctv_customer_overdue_mep &&
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
            data: {
                ctv_customer_overdue_mep: snap.ctv_customer_overdue_mep,
                ctv_customer_excluded_from_policy: snap.ctv_customer_excluded_from_policy,
                ctv_outdated_dcl: snap.ctv_outdated_dcl,
                ctv_invoice_after_policy_end: snap.ctv_invoice_after_policy_end,
            },
        });
    }
    await runWithConcurrency(pending, CTV_SNAPSHOT_UPDATE_CONCURRENCY, async (u) => {
        await db.invoice.update({
            where: { id: u.id },
            data: u.data,
        });
    });
    return pending.length;
}
/**
 * Clear the "customer excluded from policy at creation" invoice flag
 * ({@link Invoice.ctv_customer_excluded_from_policy}) for every invoice of a customer
 * once the customer is included again (active policy `excluded_from_policy` is not true).
 * No-op while the customer is still excluded.
 */
async function clearCustomerExcludedFromPolicyFlagWhenIncluded(customerId, db = domain_db_1.prisma) {
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
/**
 * Recompute terms-breach invoice flags for a customer's open Due/Overdue invoices
 * after policy exclusion or limit-type changes. Also clears the "excluded from policy
 * at creation" flag across all of the customer's invoices when they are now included.
 */
async function refreshTermsBreachFlagsForCustomer(customerId, db = domain_db_1.prisma) {
    let updated = await clearCustomerExcludedFromPolicyFlagWhenIncluded(customerId, db);
    const invoices = await db.invoice.findMany({
        where: {
            customer_id: customerId,
            status: { in: ["Due", "Overdue"] },
        },
        select: { id: true },
    });
    const invoiceIds = invoices.map((row) => row.id);
    if (invoiceIds.length === 0) {
        return updated;
    }
    updated += await refreshCtvSnapshotsForInvoiceIds(invoiceIds, db);
    updated += await refreshPaymentTermBreachForInvoiceIds(invoiceIds, db);
    updated += await refreshInsuranceTargetDatesForInvoiceIds(invoiceIds, db);
    return updated;
}
