/**
 * ISO-code money display aligned with FE formatMoney({ style: "iso" }).
 * EN: `USD 1,200` — HE: `1,200 USD` with LTR mark.
 */
export function formatMoneyIso(
    amount: number,
    currency: string | null | undefined,
    locale: string = "en-US"
): string {
    const currencyCode =
        (currency && String(currency).trim().toUpperCase()) || "USD";
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    const language = locale.toLowerCase().startsWith("he") ? "he" : "en";
    let formattedAmount: string;
    try {
        const hasDecimalPlaces = Math.abs(safeAmount % 1) > 0.0001;
        formattedAmount = new Intl.NumberFormat(locale, {
            minimumFractionDigits: hasDecimalPlaces ? 2 : 0,
            maximumFractionDigits: hasDecimalPlaces ? 2 : 0,
        }).format(safeAmount);
    } catch {
        formattedAmount = String(safeAmount);
    }
    const nbsp = "\u00A0";
    if (language === "he") {
        return `\u200E${formattedAmount}${nbsp}${currencyCode}`;
    }
    return `${currencyCode}${nbsp}${formattedAmount}`;
}

export function isMoneyFieldName(field: string): boolean {
    const lower = field.toLowerCase();
    return (
        lower.includes("amount") ||
        lower.includes("debt") ||
        lower.includes("paid") ||
        lower.includes("outstanding") ||
        lower.includes("exposure") ||
        lower.includes("premium") ||
        lower === "approved_limit" ||
        lower === "effective_approved_limit" ||
        lower === "capacity_gap_amount" ||
        lower === "top_up_value" ||
        lower === "top_up_resolved_amount" ||
        lower === "at_risk_exposure" ||
        lower === "policy_risk_allocated" ||
        lower === "terms_breach_outstanding"
    );
}

export function isMoneyMetadataType(metadataType?: string): boolean {
    const normalized = metadataType?.toLowerCase();
    return normalized === "amount" || normalized === "currency";
}
