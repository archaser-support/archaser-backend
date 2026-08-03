/** Convert BigInt values for JSON responses (Nest domains). */
export function serializeBigInt<T>(value: T): T {
    return JSON.parse(
        JSON.stringify(value, (_key, v) =>
            typeof v === "bigint" ? v.toString() : v
        )
    ) as T;
}
