import mongoose from "mongoose";
export declare function ensureMongoConnection(): Promise<typeof mongoose>;
export { mongoose };
