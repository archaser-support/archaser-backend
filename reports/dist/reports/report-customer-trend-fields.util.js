"use strict";
/**
 * Virtual Customer fields resolved from the latest CustomerPolicyTrend snapshot.
 * Port of frontend reportCustomerTrendCostFields (subset needed by credit dashboards).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TREND_COST_BACKED_REPORT_FIELDS = void 0;
exports.isTrendCostBackedReportField = isTrendCostBackedReportField;
exports.getLatestCustomerPolicyTrendRow = getLatestCustomerPolicyTrendRow;
exports.extractTrendCostReportField = extractTrendCostReportField;
exports.mergeLatestCustomerPolicyTrendSelect = mergeLatestCustomerPolicyTrendSelect;
exports.TREND_COST_BACKED_REPORT_FIELDS = new Set([
    "top_up_total",
    "effective_approved_limit",
]);
const TREND_FIELD_TO_COLUMN = {
    top_up_total: "top_up_total",
    effective_approved_limit: "effective_approved_limit",
};
function isTrendCostBackedReportField(field) {
    return exports.TREND_COST_BACKED_REPORT_FIELDS.has(field);
}
function coerceReportNumeric(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "number") {
        return Number.isNaN(value) ? null : value;
    }
    if (typeof value === "object" && value !== null && "toNumber" in value) {
        try {
            const n = value.toNumber();
            return Number.isFinite(n) ? n : null;
        }
        catch {
            return null;
        }
    }
    const n = parseFloat(String(value));
    return Number.isNaN(n) ? null : n;
}
function getLatestCustomerPolicyTrendRow(row) {
    if (!row || typeof row !== "object") {
        return null;
    }
    const trend = row
        .CustomerPolicyTrend;
    if (!trend) {
        return null;
    }
    const rows = Array.isArray(trend) ? trend : [trend];
    const valid = rows.filter((entry) => !!entry && typeof entry === "object");
    return valid[0] ?? null;
}
function extractTrendCostReportField(row, field) {
    if (!isTrendCostBackedReportField(field)) {
        return null;
    }
    const trendRow = getLatestCustomerPolicyTrendRow(row);
    if (!trendRow) {
        return null;
    }
    const column = TREND_FIELD_TO_COLUMN[field] ?? field;
    const raw = trendRow[column];
    if (raw === null || raw === undefined) {
        return null;
    }
    return coerceReportNumeric(raw);
}
function mergeLatestCustomerPolicyTrendSelect(select, fields) {
    const trendSelect = { snapshot_date: true };
    for (const field of fields) {
        if (isTrendCostBackedReportField(field)) {
            const column = TREND_FIELD_TO_COLUMN[field] ?? field;
            trendSelect[column] = true;
        }
    }
    if (Object.keys(trendSelect).length <= 1) {
        return;
    }
    const existing = select.CustomerPolicyTrend;
    if (!existing) {
        select.CustomerPolicyTrend = {
            orderBy: { snapshot_date: "desc" },
            take: 1,
            select: trendSelect,
        };
        return;
    }
    existing.orderBy = { snapshot_date: "desc" };
    existing.take = 1;
    if (!existing.select) {
        existing.select = {};
    }
    for (const [key, value] of Object.entries(trendSelect)) {
        existing.select[key] = value;
    }
}
