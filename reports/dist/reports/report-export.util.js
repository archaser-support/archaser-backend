"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rowsToCsv = rowsToCsv;
exports.buildReportExport = buildReportExport;
/**
 * Build CSV export bytes from report execute JSON rows.
 */
function rowsToCsv(rows) {
    if (rows.length === 0) {
        return "";
    }
    const headerSet = new Set();
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            headerSet.add(key);
        }
    }
    const headers = Array.from(headerSet);
    const escapeCell = (value) => {
        if (value == null) {
            return "";
        }
        const text = typeof value === "object"
            ? JSON.stringify(value)
            : String(value);
        if (/[",\n\r]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };
    const lines = [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
    ];
    return lines.join("\n");
}
function buildReportExport(rows, reportName, format) {
    const safeName = (reportName || "report")
        .replace(/[^\w.-]+/g, "_")
        .slice(0, 80);
    const csv = rowsToCsv(rows);
    const resolvedFormat = format === "pdf" ? "csv" : format;
    const extension = resolvedFormat === "excel" ? "csv" : resolvedFormat;
    const contentType = resolvedFormat === "excel"
        ? "application/vnd.ms-excel"
        : "text/csv; charset=utf-8";
    return {
        format: resolvedFormat,
        filename: `${safeName}.${extension}`,
        contentBase64: Buffer.from(csv, "utf8").toString("base64"),
        contentType,
    };
}
