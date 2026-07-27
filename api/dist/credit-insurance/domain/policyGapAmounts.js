"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPolicyCapacityGapSuppressed = isPolicyCapacityGapSuppressed;
exports.storedCapacityGapAmount = storedCapacityGapAmount;
exports.readCapacityGapForDisplay = readCapacityGapForDisplay;
exports.resolveCapacityGapForAtRisk = resolveCapacityGapForAtRisk;
exports.readUninsuredAmountForDisplay = readUninsuredAmountForDisplay;
exports.storedCapacityGapInCurrency = storedCapacityGapInCurrency;
exports.sumStoredCapacityGapInCurrency = sumStoredCapacityGapInCurrency;
exports.resolveStoredCapacityGapSecondary = resolveStoredCapacityGapSecondary;
const policyExclusion_1 = require("./policyExclusion");
function isPolicyCapacityGapSuppressed(c) {
    if (c.outdated_dcl === true) {
        return true;
    }
    const hasLinkedPolicy = c.insurance_policy_id !== undefined
        ? (0, policyExclusion_1.hasActiveLinkedPolicy)(c.insurance_policy_id)
        : true;
    const exclusionReason = c.policy_exclusion_reason ??
        (c.excluded_from_policy === true ? "excluded" : null);
    return (0, policyExclusion_1.isUncoveredExposureCustomer)({ hasLinkedPolicy, exclusionReason });
}
function storedCapacityGapAmount(c) {
    if (isPolicyCapacityGapSuppressed(c)) {
        return 0;
    }
    if (c.approved_limit == null || c.approved_limit === undefined) {
        return 0;
    }
    if (c.capacity_gap_amount == null) {
        return 0;
    }
    return Math.max(0, Number(c.capacity_gap_amount));
}
function readCapacityGapForDisplay(c) {
    return storedCapacityGapAmount(c);
}
function resolveCapacityGapForAtRisk(storedRow, _openAr, invoiceGap) {
    if (isPolicyCapacityGapSuppressed(storedRow)) {
        return 0;
    }
    if (invoiceGap &&
        !invoiceGap.hasMissingSnapshots &&
        invoiceGap.total != null) {
        return Math.max(0, Number(invoiceGap.total));
    }
    return storedCapacityGapAmount(storedRow);
}
function readUninsuredAmountForDisplay(c, openAr) {
    if (c.excluded_from_policy === true) {
        if (openAr == null) {
            return null;
        }
        return Math.max(0, Number(openAr));
    }
    if (c.approved_limit == null || c.approved_limit === undefined) {
        return null;
    }
    if (c.uninsured_amount == null) {
        return 0;
    }
    return Math.max(0, Number(c.uninsured_amount));
}
function storedCapacityGapInCurrency(c, currency) {
    const target = currency.trim().toUpperCase();
    if (!target) {
        return null;
    }
    const acct = c.capacity_gap_currency1?.trim().toUpperCase();
    if (acct === target && c.capacity_gap_amount1 != null) {
        return Math.max(0, Number(c.capacity_gap_amount1));
    }
    const acct2 = c.capacity_gap_currency2?.trim().toUpperCase();
    if (acct2 === target && c.capacity_gap_amount2 != null) {
        return Math.max(0, Number(c.capacity_gap_amount2));
    }
    return null;
}
function sumStoredCapacityGapInCurrency(rows, currency) {
    const target = currency.trim().toUpperCase();
    if (!target) {
        return null;
    }
    let total = 0;
    let found = false;
    for (const row of rows) {
        const part = storedCapacityGapInCurrency(row, target);
        if (part != null) {
            total += part;
            found = true;
        }
    }
    return found ? total : null;
}
function resolveStoredCapacityGapSecondary(rows, currency, options) {
    let scoped;
    if (options?.policyId != null) {
        const row = rows.find((r) => r.insurance_policy_id === options.policyId);
        scoped = row ? [row] : [];
    }
    else {
        const byPolicyId = new Map();
        for (const row of rows) {
            const pid = row.insurance_policy_id;
            if (pid == null) {
                continue;
            }
            const existing = byPolicyId.get(pid);
            if (!existing || (row.is_active && !existing.is_active)) {
                byPolicyId.set(pid, row);
            }
        }
        scoped = Array.from(byPolicyId.values());
    }
    return sumStoredCapacityGapInCurrency(scoped, currency);
}
//# sourceMappingURL=policyGapAmounts.js.map