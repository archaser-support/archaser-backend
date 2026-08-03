import * as dotenv from "dotenv";
import path from "path";

// Load env vars
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import mongoose from "mongoose";
import { ensureMongoConnection } from "../frontend/lib/mongoose";
import Log from "../frontend/models/Log";

async function analyzeLogs() {
    console.log("🔍 Analyzing Log Data for Dashboard Design...");

    try {
        await ensureMongoConnection();

        // 1. Level Distribution
        console.log("\n📊 Log Levels:");
        const levels = await Log.aggregate([
            { $group: { _id: "$level", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
        ]);
        console.table(levels);

        // 2. Top Sources
        console.log("\n🏭 Top Sources:");
        const sources = await Log.aggregate([
            { $group: { _id: "$source", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 15 },
        ]);
        console.table(sources);

        // 3. Error Analysis
        console.log("\n❌ Common Errors (Sample):");
        const errors = await Log.aggregate([
            { $match: { level: "error" } },
            { $group: { _id: "$message", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
        ]);
        console.table(errors);

        // 4. Details Structure (Check for numbers/metrics)
        console.log("\n📋 Details Field Exploration:");
        const sampleLog = await Log.findOne({
            details: { $exists: true, $ne: {} },
        }).sort({ timestamp: -1 });

        if (sampleLog && sampleLog.details) {
            console.log("Sample Details keys:", Object.keys(sampleLog.details));
            console.log(
                "Sample Details value:",
                JSON.stringify(sampleLog.details, null, 2)
            );
        }

        process.exit(0);
    } catch (error) {
        console.error("Analysis failed:", error);
        process.exit(1);
    }
}

analyzeLogs();
