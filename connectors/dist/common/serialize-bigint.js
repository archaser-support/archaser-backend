"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeBigInt = serializeBigInt;
/** Convert BigInt values for JSON responses (Nest domains). */
function serializeBigInt(value) {
    return JSON.parse(JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v));
}
