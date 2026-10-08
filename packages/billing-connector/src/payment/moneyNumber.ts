/**
 * Coerce Prisma Decimal / string / number payment amounts to JS number for
 * billing math. InvoicePayment money columns are Decimal(20, 4).
 */
export function toMoneyNumber(value: unknown): number {
    if (value == null) {
        return 0;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (
        typeof value === "object" &&
        typeof (value as { toNumber?: unknown }).toNumber === "function"
    ) {
        const parsed = (value as { toNumber: () => number }).toNumber();
        return Number.isFinite(parsed) ? parsed : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Equality at Decimal(20, 4) scale (avoids float32 Real compare). */
export function sameMoneyAmount(existing: number, next: number): boolean {
    return Math.round(existing * 10_000) === Math.round(next * 10_000);
}
