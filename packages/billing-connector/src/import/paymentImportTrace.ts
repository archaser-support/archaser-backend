/**
 * Temporary debug trace for specific ERP payment lines through connector import.
 *
 * Matches rows when FNCNUM / IVNUM / FNCIREF1 / reference contains a trace key.
 * Default keys include the SI26ED0000488 / 10714824402 investigation pair.
 *
 * Disable: BILLING_PAYMENT_TRACE=off
 * Override: BILLING_PAYMENT_TRACE=26063733,SI260000488
 */

const DEFAULT_TRACE_KEYS = [
    "SI260000488",
    "26002558",
    "26063733",
    "SI26ED0000488",
    "RC26ED0000310",
    "26014108",
    "26015834",
] as const;

function parseTraceKeys(): Set<string> {
    const env = process.env.BILLING_PAYMENT_TRACE?.trim();
    if (env === "0" || env === "off" || env === "false") {
        return new Set();
    }
    if (env && env.length > 0) {
        return new Set(
            env
                .split(/[,;\s]+/)
                .map((part) => part.trim())
                .filter(Boolean)
        );
    }
    return new Set(DEFAULT_TRACE_KEYS);
}

let traceKeys = parseTraceKeys();
let traceSink: ((message: string) => void) | null = null;

/** Route traces into Nest sync onLog so they show as BillingConnectorApiService lines. */
export function setPaymentImportTraceSink(
    sink: ((message: string) => void) | null
): void {
    traceSink = sink;
}

export function getPaymentImportTraceKeys(): string[] {
    return [...traceKeys];
}

/** Re-read env (tests). */
export function resetPaymentImportTraceKeysForTests(): void {
    traceKeys = parseTraceKeys();
}

function asTraceString(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value).trim();
    }
    if (typeof value !== "string") {
        return "";
    }
    return value.trim();
}

function rowMatchesTraceKey(value: string, keys: Set<string>): boolean {
    if (!value) {
        return false;
    }
    if (keys.has(value)) {
        return true;
    }
    for (const key of keys) {
        if (value.includes(key)) {
            return true;
        }
    }
    return false;
}

type TraceablePaymentRow = Record<string, unknown>;

function asTraceableRow(row: TraceablePaymentRow | object): TraceablePaymentRow {
    return row as TraceablePaymentRow;
}

export function isTracedPaymentRow(row: TraceablePaymentRow | object): boolean {
    const traceable = asTraceableRow(row);
    if (traceKeys.size === 0) {
        return false;
    }
    const raw =
        traceable._rawRecord && typeof traceable._rawRecord === "object"
            ? (traceable._rawRecord as Record<string, unknown>)
            : traceable;

    const candidates = [
        raw.FNCNUM,
        raw.IVNUM,
        raw.FNCIREF1,
        raw.FRECONNUM,
        raw.PAY_REFERENCE,
        raw.PAY_INVOICE_NUMBER,
        traceable.FNCNUM,
        traceable.IVNUM,
        traceable.FNCIREF1,
        traceable.reference,
        traceable.invoice_number,
        traceable.PAY_REFERENCE,
        traceable.PAY_INVOICE_NUMBER,
    ];

    for (const candidate of candidates) {
        if (rowMatchesTraceKey(asTraceString(candidate), traceKeys)) {
            return true;
        }
    }
    return false;
}

export function flattenPaymentRowForTrace(
    row: TraceablePaymentRow | object
): Record<string, unknown> {
    const traceable = asTraceableRow(row);
    const raw =
        traceable._rawRecord && typeof traceable._rawRecord === "object"
            ? (traceable._rawRecord as Record<string, unknown>)
            : traceable;
    return {
        fncnum: asTraceString(raw.FNCNUM ?? traceable.FNCNUM),
        ivnum: asTraceString(raw.IVNUM ?? traceable.IVNUM),
        fnciref1: asTraceString(raw.FNCIREF1 ?? traceable.FNCIREF1),
        freconnum: asTraceString(raw.FRECONNUM ?? traceable.FRECONNUM),
        kline: asTraceString(raw.KLINE ?? traceable.KLINE),
        fncpatname: asTraceString(raw.FNCPATNAME ?? traceable.FNCPATNAME),
        glname: asTraceString(raw.GLNAME ?? traceable.GLNAME),
        debit1: raw.DEBIT1 ?? traceable.DEBIT1,
        credit1: raw.CREDIT1 ?? traceable.CREDIT1,
        bal: raw.BAL ?? traceable.BAL,
        reference: asTraceString(traceable.reference ?? traceable.PAY_REFERENCE),
        invoice_number: asTraceString(
            traceable.invoice_number ?? traceable.PAY_INVOICE_NUMBER
        ),
        customer_number: asTraceString(traceable.customer_number),
        pay_amount: traceable.customer_amount ?? traceable.amount ?? traceable.PAY_AMOUNT,
        payment_date: traceable.payment_date ?? traceable.PAY_DATE,
    };
}

/** Structured console trace — remove before production commit when done debugging. */
export function tracePaymentImport(
    stage: string,
    row: TraceablePaymentRow | object,
    detail: Record<string, unknown> = {}
): void {
    if (!isTracedPaymentRow(row)) {
        return;
    }
    const payload = {
        stage,
        ...flattenPaymentRowForTrace(row),
        ...detail,
    };
    const line = `[payment-trace] ${JSON.stringify(payload)}`;
    if (traceSink) {
        traceSink(line);
    }
    console.log(line);
}

export function tracePaymentImportByRaw(
    stage: string,
    raw: Record<string, unknown>,
    detail: Record<string, unknown> = {}
): void {
    tracePaymentImport(stage, { ...raw, _rawRecord: raw }, detail);
}
