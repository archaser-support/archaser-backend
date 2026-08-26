import type { PrismaClient } from "@prisma/client";
/**
 * Run Prisma writes as sequential transactions, keeping `this` bound on
 * `$transaction`. Extracting the method (`const run = prisma.$transaction`)
 * leaves `this` undefined and crashes with `_tracingHelper`.
 */
export declare function commitOps<T>(prisma: {
    $transaction: PrismaClient["$transaction"];
}, ops: T[]): Promise<T[]>;
export declare function lastWinsByKey<T>(items: T[], keyOf: (item: T) => string): T[];
