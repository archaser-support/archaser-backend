import mongoose from "mongoose";
/**
 * Shared mongoose connect for billing-connector sync history (Nest + cron).
 * Uses `MONGODB_URI`, defaulting to the same local URI as Nest API logs Mongo.
 */
export declare function ensureMongoConnection(): Promise<typeof mongoose>;
export { mongoose };
