import * as dotenv from "dotenv";
import path from "path";

// Load env vars from the root .env file
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { mongoLogService } from "../frontend/server/services/MongoLogService";
import { lokiTransportService } from "../frontend/server/services/LokiTransportService";
import Log from "../frontend/models/Log";
import mongoose from "mongoose";
import { ensureMongoConnection } from "../frontend/lib/mongoose";

/**
 * Migration Script: MongoDB -> Loki
 *
 * Reads all logs from MongoDB and pushes them to Loki.
 * Uses batching to prevent memory issues and network overload.
 */
async function migrateLogs() {
    console.log("🚀 Starting migration: MongoDB Logs -> Loki");
    console.log("-------------------------------------------");

    try {
        // 1. Connect to Mongo
        await ensureMongoConnection();
        console.log("✅ Connected to MongoDB");

        // 2. Count total logs
        const totalLogs = await Log.countDocuments({});
        console.log(`📊 Found ${totalLogs} logs to migrate`);

        if (totalLogs === 0) {
            console.log("Nothing to migrate.");
            process.exit(0);
        }

        // 3. Process in batches
        const BATCH_SIZE = 100;
        let processed = 0;
        let cursor = Log.find({}).sort({ timestamp: 1 }).cursor();

        for await (const doc of cursor) {
            // Convert Mongoose doc to LogData interface structure
            // We need to cast or map it carefully
            const logData: any = doc.toObject();

            // Map _id to id if needed, though Loki doesn't store the ID structure directly
            // sending to Loki wrapper
            const logPayload = {
                level: logData.level,
                message: logData.message,
                source: logData.source || "unknown",
                timestamp: logData.timestamp,
                details: logData.details,
                account_id: logData.account_id,
                user_id: logData.user_id,
                job_id: logData.job_id,
                correlation_id: logData.correlation_id,
                sub_source: logData.sub_source,
            };

            // Use the public pushLog method to await completion
            await lokiTransportService
                .pushLog(logPayload)
                .catch((err: any) => {
                    console.error(
                        `❌ Failed to push log ${doc._id}:`,
                        err.message
                    );
                });

            processed++;
            if (processed % BATCH_SIZE === 0) {
                process.stdout.write(
                    `\r⏳ Migrated ${processed}/${totalLogs} (${Math.round((processed / totalLogs) * 100)}%)`
                );
                // Tiny pause to being nice to Loki local instance
                await new Promise((r) => setTimeout(r, 50));
            }
        }

        console.log(
            `\n\n✅ Migration Complete! Successfully migrated ${processed} logs.`
        );
        process.exit(0);
    } catch (error) {
        console.error("\n❌ Migration Failed:", error);
        process.exit(1);
    }
}

// Run the migration
// Enable Loki logging for this script run explicitly
process.env.ENABLE_LOKI_LOGGING = "true";
process.env.LOKI_HOST = process.env.LOKI_HOST || "http://localhost:3100";

migrateLogs();
