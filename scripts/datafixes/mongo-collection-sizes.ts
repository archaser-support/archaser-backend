/**
 * Print Mongo collection storage sizes (MB) for the configured MONGODB_URI.
 *
 * Usage:
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/mongo-collection-sizes.ts
 */
import { resolve } from "path";

import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

import {
    ensureMongoConnection,
    mongoose,
} from "../../packages/billing-connector/src/syncHistory/mongooseConnection";

async function main(): Promise<void> {
    await ensureMongoConnection();
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error("Mongo connection has no db");
    }

    const cols = await db.listCollections().toArray();
    const rows: Array<{
        name: string;
        count: number;
        sizeMB: number;
        storageMB: number;
        avgObjKB: number;
    }> = [];

    for (const c of cols) {
        const s = (await db.command({ collStats: c.name })) as {
            count: number;
            size: number;
            storageSize: number;
        };
        rows.push({
            name: c.name,
            count: s.count,
            sizeMB: +(s.size / 1024 / 1024).toFixed(2),
            storageMB: +(s.storageSize / 1024 / 1024).toFixed(2),
            avgObjKB: s.count
                ? +((s.size / s.count) / 1024).toFixed(2)
                : 0,
        });
    }

    rows.sort((a, b) => b.storageMB - a.storageMB);
    console.log(JSON.stringify(rows, null, 2));

    const dbStats = (await db.command({
        dbStats: 1,
        scale: 1024 * 1024,
    })) as {
        dataSize: number;
        storageSize: number;
        indexSize: number;
    };
    console.log("dbStats_MB", {
        dataSize: +dbStats.dataSize.toFixed(2),
        storageSize: +dbStats.storageSize.toFixed(2),
        indexSize: +dbStats.indexSize.toFixed(2),
    });
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    });
