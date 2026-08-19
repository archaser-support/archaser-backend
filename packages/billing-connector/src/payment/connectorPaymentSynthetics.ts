/**
 * Flatten Priority payment source rows into synthetic fields expected by mapping.
 *
 * IDG_ARFNCITEMS4 (and similar AR line feeds):
 * - PAY_AMOUNT = non-zero CREDIT1 else DEBIT1 (else CREDIT/DEBIT)
 * - PAY_DATE = FNCDATE else BALDATE
 * - PAY_REFERENCE = FRECONNUM|FNCNUM(|KLINE) when recon is present;
 *   else FNCNUM(|KLINE); else IVNUM/PAYNUM fallbacks
 * - PAYDES = trimmed FNCPATNAME when present (maps to payment_method)
 */

function asNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function asTrimmedString(value: unknown): string | undefined {
    if (value === null || value === undefined || value === "") {
        return undefined;
    }
    const s = String(value).trim();
    return s.length > 0 ? s : undefined;
}

function withOptionalKline(base: string, kline: unknown): string {
    const k = asTrimmedString(kline);
    return k ? `${base}|${k}` : base;
}

function pickNonZeroAmount(row: Record<string, unknown>): number | null {
    const credit1 = asNumber(row.CREDIT1);
    if (credit1 !== null && credit1 !== 0) {
        return credit1;
    }
    const debit1 = asNumber(row.DEBIT1);
    if (debit1 !== null && debit1 !== 0) {
        return debit1;
    }
    const credit = asNumber(row.CREDIT);
    if (credit !== null && credit !== 0) {
        return credit;
    }
    const debit = asNumber(row.DEBIT);
    if (debit !== null && debit !== 0) {
        return debit;
    }
    return null;
}

function pickPaymentDate(row: Record<string, unknown>): unknown {
    const fncDate = row.FNCDATE;
    if (fncDate !== null && fncDate !== undefined && fncDate !== "") {
        return fncDate;
    }
    const balDate = row.BALDATE;
    if (balDate !== null && balDate !== undefined && balDate !== "") {
        return balDate;
    }
    return undefined;
}

/**
 * Canonical payment reference for import identity.
 * Prefer FRECONNUM|FNCNUM so split settlements group and cancel lines stay unique.
 */
export function buildPaymentReference(
    row: Record<string, unknown>
): string | undefined {
    const freconnum = asTrimmedString(row.FRECONNUM);
    const fncnum = asTrimmedString(row.FNCNUM);
    const kline = row.KLINE;

    if (freconnum && fncnum) {
        return withOptionalKline(`${freconnum}|${fncnum}`, kline);
    }
    if (fncnum) {
        return withOptionalKline(fncnum, kline);
    }

    const refSource =
        row.IVNUM ??
        row.PAYNUM ??
        row.TRANSNUM ??
        row.DOCNUM ??
        row.FNCIREF1;
    const strRef = asTrimmedString(refSource);
    if (!strRef) {
        return undefined;
    }
    const k = asTrimmedString(kline);
    if (k) {
        return `${strRef}|${k}`;
    }
    const fnciref1 = asTrimmedString(row.FNCIREF1);
    if (fnciref1 && strRef !== fnciref1) {
        return `${strRef}|${fnciref1}`;
    }
    return strRef;
}

/**
 * All reference strings that can identify the same ERP payment line.
 * Used so a re-sync matches rows stored as IVNUM|KLINE or FNCNUM|KLINE.
 */
export function collectPaymentReferenceAliases(
    row: Record<string, unknown>,
    mappedReference?: string,
    invoiceNumber?: string
): string[] {
    const aliases = new Set<string>();
    const add = (value: string | undefined) => {
        const trimmed = asTrimmedString(value);
        if (trimmed) {
            aliases.add(trimmed);
        }
    };

    add(mappedReference);
    add(buildPaymentReference(row));

    const fncnum = asTrimmedString(row.FNCNUM);
    const ivnum = asTrimmedString(row.IVNUM);
    const kline = asTrimmedString(row.KLINE);
    if (fncnum) {
        add(fncnum);
        if (kline) {
            add(`${fncnum}|${kline}`);
        }
    }
    if (ivnum) {
        add(ivnum);
        if (kline) {
            add(`${ivnum}|${kline}`);
        }
    }

    const raw = asTrimmedString(mappedReference);
    const invoice = asTrimmedString(invoiceNumber);
    if (raw && invoice && !raw.includes("|") && raw !== invoice) {
        add(`${raw}|${invoice}`);
    }

    return Array.from(aliases);
}

function pickPaymentInvoiceNumber(row: Record<string, unknown>): string | undefined {
    const fnciref1 = asTrimmedString(row.FNCIREF1);
    if (fnciref1) {
        return fnciref1;
    }
    return asTrimmedString(row.IVNUM);
}

export const PAYMENT_SYNTHETIC_FIELDS = [
    "PAY_AMOUNT",
    "PAY_DATE",
    "PAY_REFERENCE",
    "PAY_INVOICE_NUMBER",
] as const;

/**
 * Returns a shallow copy with synthetic payment fields applied.
 * Does not drop rows — callers filter via pull filters / validation.
 */
export function applyPaymentSynthetics(
    row: Record<string, unknown>
): Record<string, unknown> {
    const next: Record<string, unknown> = { ...row };
    const amount = pickNonZeroAmount(row);
    if (amount !== null) {
        next.PAY_AMOUNT = amount;
    }
    const payDate = pickPaymentDate(row);
    if (payDate !== undefined) {
        next.PAY_DATE = payDate;
    }
    const reference = buildPaymentReference(row);
    if (reference !== undefined) {
        next.PAY_REFERENCE = reference;
    }
    const invoiceNumber = pickPaymentInvoiceNumber(row);
    if (invoiceNumber !== undefined) {
        next.PAY_INVOICE_NUMBER = invoiceNumber;
    }
    const fncPatName = asTrimmedString(row.FNCPATNAME);
    if (fncPatName) {
        next.PAYDES = fncPatName;
    }
    return next;
}

export function applyPaymentSyntheticsToRecords(
    records: Record<string, unknown>[]
): Record<string, unknown>[] {
    return records.map((row) => applyPaymentSynthetics(row));
}
