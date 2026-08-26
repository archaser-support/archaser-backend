"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commitOps = commitOps;
exports.lastWinsByKey = lastWinsByKey;
const TRANSACTION_CHUNK = 100;
/**
 * Run Prisma writes as sequential transactions, keeping `this` bound on
 * `$transaction`. Extracting the method (`const run = prisma.$transaction`)
 * leaves `this` undefined and crashes with `_tracingHelper`.
 */
async function commitOps(prisma, ops) {
    if (ops.length === 0)
        return [];
    const results = [];
    for (let i = 0; i < ops.length; i += TRANSACTION_CHUNK) {
        const chunk = ops.slice(i, i + TRANSACTION_CHUNK);
        const part = await prisma.$transaction(chunk);
        results.push(...part);
    }
    return results;
}
function lastWinsByKey(items, keyOf) {
    const winners = new Map();
    for (const item of items) {
        winners.set(keyOf(item), item);
    }
    return Array.from(winners.values());
}
