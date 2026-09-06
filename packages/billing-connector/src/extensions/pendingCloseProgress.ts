/** Chunk size for pending-close progress callbacks (matches invoice recalc). */
export const PENDING_CLOSE_PROGRESS_CHUNK = 200;

/** Unique trimmed invoice numbers in the virtual-close queue. */
export function countUniquePendingCloseInvoiceNumbers(
    invoiceNumbers: string[],
    /** @deprecated Helam stamp-close removed; ignored when passed. */
    _helamOffsetInvoiceNumbers: string[] = []
): number {
    return uniqueTrimmedInvoiceNumberSet(invoiceNumbers).size;
}

export function uniqueTrimmedInvoiceNumberSet(values: string[]): Set<string> {
    const unique = new Set<string>();
    for (const value of values) {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
            unique.add(trimmed);
        }
    }
    return unique;
}
