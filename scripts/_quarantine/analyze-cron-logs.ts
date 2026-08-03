import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });
import { ensureMongoConnection } from "../frontend/lib/mongoose";
import Log from "../frontend/models/Log";

async function analyzeCronLogs() {
    try {
        await ensureMongoConnection();
        console.log("🔍 Searching for Cron Logs...");

        // Find logs with correlation_id starting with 'cron'
        const cronLogs = await Log.find({
            correlation_id: { $regex: /^cron/ },
        })
            .limit(5)
            .lean();

        console.log(`Found ${cronLogs.length} cron logs samples.`);
        cronLogs.forEach((l) => {
            console.log(
                `[${l.level}] Source: ${l.source}, CID: ${l.correlation_id}`
            );
        });

        // Check if there are other indicators
        const sources = await Log.distinct("source", {
            correlation_id: { $regex: /^cron/ },
        });
        console.log("Cron Sources:", sources);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
analyzeCronLogs();
