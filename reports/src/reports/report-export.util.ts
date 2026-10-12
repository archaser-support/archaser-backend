/**
 * Build CSV/Excel export bytes from report execute JSON rows.
 * Mirrors frontend exportToExcel money-with-currency split rules (no shared package).
 */

/** Strip bidi marks / NBSP so Hebrew money strings split and parse cleanly. */
const normalizeMoneyText = (value: string): string =>
    value
        .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
        .replace(/\u00A0/g, " ")
        .trim();

/** Pre-formatted amount strings that include a currency code or symbol. */
const looksLikeFormattedCurrency = (value: unknown): boolean => {
    if (typeof value !== "string") {
        return false;
    }
    const v = value.trim();
    if (!v) {
        return false;
    }
    return /[0-9]/.test(v) && /[A-Za-z₪$€£¥]/.test(v);
};

type SplitCurrencyResult = {
    amount: string;
    currency: string;
};

/**
 * Split currency values into amount and currency.
 * Handles "USD 1,234" (currency first) and "1,234 USD" (amount first).
 */
export const splitCurrencyValue = (value: unknown): SplitCurrencyResult => {
    if (value === null || value === undefined || value === "") {
        return { amount: "", currency: "" };
    }

    const stringValue = normalizeMoneyText(String(value));

    if (
        stringValue === "NaN" ||
        stringValue === "undefined" ||
        stringValue === "null"
    ) {
        return { amount: "", currency: "" };
    }

    const currencyFirstMatch = stringValue.match(/^([A-Z₪$€£¥]+)\s+(.+)$/);
    const amountFirstMatch = stringValue.match(/^(.+)\s+([A-Z₪$€£¥]+)$/);

    if (currencyFirstMatch) {
        return {
            currency: currencyFirstMatch[1],
            amount: normalizeMoneyText(currencyFirstMatch[2]),
        };
    }

    if (amountFirstMatch) {
        return {
            amount: normalizeMoneyText(amountFirstMatch[1]),
            currency: amountFirstMatch[2],
        };
    }

    return {
        amount: stringValue,
        currency: "",
    };
};

/** ISO currency code (2–3 letters) or a common currency symbol. */
const isCurrencyToken = (token: string): boolean =>
    /^([A-Z]{2,3}|[₪$€£¥])$/.test(token);

/**
 * True when a cell is money-with-currency text that can be split into a
 * parseable amount and a real currency code/symbol.
 */
const isMoneyWithCurrencyValue = (value: unknown): boolean => {
    if (!looksLikeFormattedCurrency(value)) {
        return false;
    }
    const { amount, currency } = splitCurrencyValue(value);
    if (!currency || !isCurrencyToken(currency)) {
        return false;
    }
    const numeric = Number(
        normalizeMoneyText(String(amount)).replace(/,/g, "")
    );
    return Number.isFinite(numeric);
};

/** Parse a split/bare amount string into a real number when possible. */
const parseExportAmount = (amount: unknown): number | string => {
    if (typeof amount === "number") {
        return Number.isFinite(amount) ? amount : "";
    }
    if (amount === null || amount === undefined || amount === "") {
        return "";
    }
    const cleaned = normalizeMoneyText(String(amount)).replace(/,/g, "");
    if (!cleaned) {
        return "";
    }
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? numeric : String(amount);
};

const isPolicyIdentifierColumn = (columnField: string): boolean => {
    const f = columnField.toLowerCase();
    return (
        f === "policynumber" ||
        f.includes("policy_number") ||
        f.endsWith(".policy_number")
    );
};

const isIntegerNumericColumn = (columnField: string): boolean => {
    if (isPolicyIdentifierColumn(columnField)) {
        return false;
    }
    return (
        columnField.includes("days") ||
        columnField.includes("Days") ||
        ((columnField.includes("count") || columnField.includes("Count")) &&
            !columnField.includes("amount") &&
            !columnField.includes("Amount"))
    );
};

const isDateLikeColumn = (columnField: string): boolean => {
    const f = columnField.toLowerCase();
    return (
        f.includes("date") ||
        f.endsWith("_at") ||
        f.endsWith("_time") ||
        f.includes("schedule_time") ||
        f.includes("call_time") ||
        f.includes("delivery_time") ||
        f.includes("sent_time")
    );
};

const isNumericColumn = (columnField: string): boolean => {
    if (isPolicyIdentifierColumn(columnField)) {
        return false;
    }
    if (isDateLikeColumn(columnField)) {
        return false;
    }
    if (isIntegerNumericColumn(columnField)) {
        return true;
    }
    return (
        columnField.includes("amount") ||
        columnField.includes("Amount") ||
        columnField.includes("value") ||
        columnField.includes("Value") ||
        columnField.includes("quantity") ||
        columnField.includes("Quantity") ||
        columnField.includes("price") ||
        columnField.includes("Price") ||
        columnField.includes("total") ||
        columnField.includes("Total") ||
        columnField.includes("sum") ||
        columnField.includes("Sum") ||
        columnField.includes("balance") ||
        columnField.includes("Balance") ||
        columnField.includes("debt") ||
        columnField.includes("Debt") ||
        columnField.includes("payment") ||
        columnField.includes("Payment") ||
        columnField.includes("outstanding") ||
        columnField.includes("Outstanding") ||
        columnField.includes("overdue") ||
        columnField.includes("Overdue") ||
        columnField.includes("original") ||
        columnField.includes("Original") ||
        columnField.includes("promise") ||
        columnField.includes("Promise") ||
        ((columnField.includes("number") || columnField.includes("Number")) &&
            !columnField.includes("invoice") &&
            !columnField.includes("Invoice") &&
            !columnField.includes("customer_number") &&
            !columnField.includes("CustomerNumber") &&
            !columnField.includes("policy"))
    );
};

const isInternalExportKey = (key: string): boolean =>
    key.startsWith("___formatted_") || key.startsWith("__link_");

const exportCurrencyHeaderFor = (header: string): string =>
    `${header} (Currency)`;

/**
 * Prefer ___formatted_* display values (same as UI report/grid export),
 * then drop internal metadata keys from the file payload.
 */
export function prepareRowsForFileExport(
    rows: Record<string, unknown>[]
): Record<string, unknown>[] {
    return rows.map((row) => {
        const prepared: Record<string, unknown> = { ...row };
        for (const key of Object.keys(row)) {
            if (!key.startsWith("___formatted_")) {
                continue;
            }
            const mainKey = key.slice("___formatted_".length);
            if (row[key] !== undefined && row[key] !== null) {
                prepared[mainKey] = row[key];
            }
        }
        for (const key of Object.keys(prepared)) {
            if (isInternalExportKey(key)) {
                delete prepared[key];
            }
        }
        return prepared;
    });
}

type MoneySplitResult = {
    columns: string[];
    headers: string[];
    rows: Record<string, unknown>[];
};

/**
 * Split money-with-currency cells into numeric amount + `{Header} (Currency)`.
 * Currency sibling is added only when ≥1 value in that column is money-with-currency.
 */
export function applyMoneyCurrencySplit(
    rows: Record<string, unknown>[]
): MoneySplitResult {
    if (rows.length === 0) {
        return { columns: [], headers: [], rows: [] };
    }

    const headerSet = new Set<string>();
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            headerSet.add(key);
        }
    }
    const baseColumns = Array.from(headerSet);

    const currencySiblingFields = new Set<string>();
    const autoSplitAmountFields = new Set<string>();
    const columns: string[] = [];
    const headers: string[] = [];

    for (const col of baseColumns) {
        columns.push(col);
        headers.push(col);

        if (
            isPolicyIdentifierColumn(col) ||
            isIntegerNumericColumn(col)
        ) {
            continue;
        }

        const hasMoneyWithCurrency = rows.some((row) =>
            isMoneyWithCurrencyValue(row[col])
        );
        if (!hasMoneyWithCurrency) {
            continue;
        }

        const currencyCol = exportCurrencyHeaderFor(col);
        columns.push(currencyCol);
        headers.push(currencyCol);
        currencySiblingFields.add(currencyCol);
        autoSplitAmountFields.add(col);
    }

    const exportRows = rows.map((row) => {
        const exportRow: Record<string, unknown> = {};

        for (const columnField of columns) {
            if (currencySiblingFields.has(columnField)) {
                const amountField = columnField.replace(/ \(Currency\)$/, "");
                const raw = row[amountField];
                if (isMoneyWithCurrencyValue(raw)) {
                    exportRow[columnField] = splitCurrencyValue(raw).currency;
                } else {
                    exportRow[columnField] = "";
                }
                continue;
            }

            if (autoSplitAmountFields.has(columnField)) {
                const raw = row[columnField];
                if (typeof raw === "number") {
                    exportRow[columnField] = parseExportAmount(raw);
                } else if (typeof raw === "string" && raw.trim() !== "") {
                    const { amount } = splitCurrencyValue(raw);
                    exportRow[columnField] = parseExportAmount(amount);
                } else {
                    exportRow[columnField] = raw ?? "";
                }
                continue;
            }

            const cellValue = row[columnField];

            // Bare numeric strings in money/amount columns → real numbers.
            if (
                !currencySiblingFields.has(columnField) &&
                isNumericColumn(columnField) &&
                typeof cellValue === "string" &&
                cellValue.trim() !== "" &&
                !looksLikeFormattedCurrency(cellValue)
            ) {
                exportRow[columnField] = parseExportAmount(cellValue);
            } else if (
                !currencySiblingFields.has(columnField) &&
                isNumericColumn(columnField) &&
                isMoneyWithCurrencyValue(cellValue)
            ) {
                const { amount } = splitCurrencyValue(cellValue);
                exportRow[columnField] = parseExportAmount(amount);
            } else if (cellValue == null) {
                exportRow[columnField] = "";
            } else if (typeof cellValue === "object") {
                exportRow[columnField] = JSON.stringify(cellValue);
            } else {
                exportRow[columnField] = cellValue;
            }
        }

        return exportRow;
    });

    return { columns, headers, rows: exportRows };
}

/**
 * Build CSV export bytes from report execute JSON rows.
 */
export function rowsToCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) {
        return "";
    }

    const prepared = prepareRowsForFileExport(rows);
    const { columns, headers, rows: exportRows } =
        applyMoneyCurrencySplit(prepared);

    if (columns.length === 0) {
        return "";
    }

    const escapeCell = (value: unknown): string => {
        if (value == null) {
            return "";
        }
        const text =
            typeof value === "object" ? JSON.stringify(value) : String(value);
        if (/[",\n\r]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };

    const lines = [
        headers.join(","),
        ...exportRows.map((row) =>
            columns.map((header) => escapeCell(row[header])).join(",")
        ),
    ];
    return lines.join("\n");
}

export type ReportExportFormat = "csv" | "excel" | "pdf";

export type ReportExportPayload = {
    format: ReportExportFormat;
    filename: string;
    contentBase64: string;
    contentType: string;
};

export function buildReportExport(
    rows: Record<string, unknown>[],
    reportName: string,
    format: ReportExportFormat
): ReportExportPayload {
    const safeName = (reportName || "report")
        .replace(/[^\w.-]+/g, "_")
        .slice(0, 80);
    // PDF remains out of scope for money display; fall back to CSV bytes.
    const csv = rowsToCsv(rows);
    const resolvedFormat = format === "pdf" ? "csv" : format;
    const extension = resolvedFormat === "excel" ? "csv" : resolvedFormat;
    const contentType =
        resolvedFormat === "excel"
            ? "application/vnd.ms-excel"
            : "text/csv; charset=utf-8";

    return {
        format: resolvedFormat,
        filename: `${safeName}.${extension}`,
        contentBase64: Buffer.from(csv, "utf8").toString("base64"),
        contentType,
    };
}
