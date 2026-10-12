/**
 * Default recognized loss for a Draft claim = open balance × insured %.
 * When insured % is null/unset, treat as 100% (PRD recommendation).
 */
export function defaultRecognizedLoss(
    openAmount: number,
    insuredPercentage: number | null | undefined
): number {
    if (!Number.isFinite(openAmount) || openAmount < 0) {
        throw new Error("openAmount must be a non-negative number");
    }
    const pct =
        insuredPercentage == null || !Number.isFinite(Number(insuredPercentage))
            ? 100
            : Number(insuredPercentage);
    if (pct < 0 || pct > 100) {
        throw new Error("insuredPercentage must be between 0 and 100");
    }
    return roundMoney((openAmount * pct) / 100);
}

export function roundMoney(value: number): number {
    return Math.round(value * 10000) / 10000;
}
