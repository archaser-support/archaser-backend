import type { PrismaClient } from "@prisma/client";

const TRANSACTION_CHUNK = 100;

/**
 * Run Prisma writes as sequential transactions, keeping `this` bound on
 * `$transaction`. Extracting the method (`const run = prisma.$transaction`)
 * leaves `this` undefined and crashes with `_tracingHelper`.
 */
export async function commitOps<T>(
    prisma: { $transaction: PrismaClient["$transaction"] },
    ops: T[]
): Promise<T[]> {
    if (ops.length === 0) return [];
    const results: T[] = [];
    for (let i = 0; i < ops.length; i += TRANSACTION_CHUNK) {
        const chunk = ops.slice(i, i + TRANSACTION_CHUNK);
        const part = await prisma.$transaction(chunk as never);
        results.push(...(part as T[]));
    }
    return results;
}

export function lastWinsByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
    const winners = new Map<string, T>();
    for (const item of items) {
        winners.set(keyOf(item), item);
    }
    return Array.from(winners.values());
}
