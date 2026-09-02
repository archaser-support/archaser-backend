export type ConnectorLiveImportType = "Invoice" | "Payment";

export interface MandatoryFieldValidationResult {
    ok: boolean;
    missingFields: string[];
    reason?: string;
}

function isBlank(value: unknown): boolean {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === "string") {
        return value.trim() === "";
    }
    return false;
}

function hasPresentAmount(
    row: Record<string, unknown>,
    fields: string[]
): boolean {
    for (const field of fields) {
        const value = row[field];
        if (value === null || value === undefined) {
            continue;
        }
        if (typeof value === "string" && value.trim() === "") {
            continue;
        }
        return true;
    }
    return false;
}

function hasPresentCurrency(
    row: Record<string, unknown>,
    fields: string[]
): boolean {
    for (const field of fields) {
        if (!isBlank(row[field])) {
            return true;
        }
    }
    return false;
}

function missingReason(missingFields: string[]): string {
    if (missingFields.length === 0) {
        return "incomplete row";
    }
    if (missingFields.length === 1) {
        return `missing ${missingFields[0]}`;
    }
    return `missing ${missingFields.slice(0, 3).join(", ")}`;
}

/** Build V4 message: "INV-88: missing due_date" */
export function formatImportIssueMessage(
    identifier: string,
    reason: string
): string {
    const id = identifier.trim() || "unknown";
    return `${id}: ${reason}`;
}

export function validateConnectorLiveImportRow(
    importType: ConnectorLiveImportType,
    mappedRow: Record<string, unknown>
): MandatoryFieldValidationResult {
    const missingFields: string[] = [];

    if (importType === "Invoice") {
        for (const field of [
            "customer_number",
            "invoice_number",
            "invoice_date",
            "due_date",
        ]) {
            if (isBlank(mappedRow[field])) {
                missingFields.push(field);
            }
        }
        if (
            !hasPresentAmount(mappedRow, [
                "amount",
                "base_amount",
                "invoice_amount",
                "customer_amount",
            ])
        ) {
            missingFields.push("amount");
        }
        if (!hasPresentCurrency(mappedRow, ["currency", "customer_currency"])) {
            missingFields.push("currency");
        }
    } else {
        for (const field of [
            "customer_number",
            "reference",
            "invoice_number",
            "payment_date",
        ]) {
            if (isBlank(mappedRow[field])) {
                missingFields.push(field);
            }
        }
        if (!hasPresentAmount(mappedRow, ["amount", "customer_amount"])) {
            missingFields.push("amount");
        }
        if (!hasPresentCurrency(mappedRow, ["customer_currency", "currency"])) {
            missingFields.push("currency");
        }
    }

    if (missingFields.length === 0) {
        return { ok: true, missingFields: [] };
    }

    return {
        ok: false,
        missingFields,
        reason: missingReason(missingFields),
    };
}
