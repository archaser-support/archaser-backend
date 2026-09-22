/**
 * List all databases and collection storage on the configured Mongo cluster.
 *
 * Usage:
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/mongo-cluster-storage.ts
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
    const admin = mongoose.connection.db?.admin();
    if (!admin) {
        throw new Error("Mongo connection has no admin");
    }

    const { databases } = await admin.listDatabases();
    console.log(
        "databases",
        databases.map((d) => ({
            name: d.name,
            sizeMB: +((d.sizeOnDisk ?? 0) / 1024 / 1024).toFixed(2),
        }))
    );

    for (const d of databases) {
        if (["admin", "local"].includes(d.name)) continue;
        const db = mongoose.connection.getClient().db(d.name);
        const cols = await db.listCollections().toArray();
        for (const c of cols) {
            const s = (await db.command({ collStats: c.name })) as {
                count: number;
                size: number;
                storageSize: number;
                totalIndexSize: number;
            };
            console.log({
                db: d.name,
                collection: c.name,
                count: s.count,
                sizeMB: +(s.size / 1024 / 1024).toFixed(2),
                storageMB: +(s.storageSize / 1024 / 1024).toFixed(2),
                indexMB: +(s.totalIndexSize / 1024 / 1024).toFixed(2),
            });
        }
    }
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
