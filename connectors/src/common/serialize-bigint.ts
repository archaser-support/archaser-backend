/** Convert BigInt / Prisma.Decimal values for JSON responses (Nest domains). */
export function serializeBigInt<T>(value: T): T {
    return JSON.parse(
        JSON.stringify(value, (_key, v) => {
            if (typeof v === "bigint") {
                return v.toString();
            }
            if (
                typeof v === "object" &&
                v !== null &&
                typeof (v as { toNumber?: unknown }).toNumber === "function"
            ) {
                return (v as { toNumber: () => number }).toNumber();
            }
            return v;
        })
    ) as T;
}
