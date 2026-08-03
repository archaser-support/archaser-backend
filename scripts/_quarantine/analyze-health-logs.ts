import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });
import { ensureMongoConnection } from "../frontend/lib/mongoose";
import Log from "../frontend/models/Log";

async function analyzeHealthLogs() {
    try {
        await ensureMongoConnection();
        console.log("🔍 Searching for SystemHealthMonitor Logs...");

        const logs = await Log.find({
            source: "SystemHealthMonitor",
        })
            .sort({ timestamp: -1 })
            .limit(5)
            .lean();

        console.log(`Found ${logs.length} health logs.`);
        logs.forEach((l) => {
            console.log(`[${l.level}] ${JSON.stringify(l.details || {})}`);
        });

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
analyzeHealthLogs();
