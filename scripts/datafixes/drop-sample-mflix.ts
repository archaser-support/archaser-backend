/**
 * Drop the unused Atlas sample dataset `sample_mflix` to free cluster storage.
 * Safe: not used by Archaser; Atlas sample loaders recreate it if needed.
 *
 * Usage:
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/drop-sample-mflix.ts --dry-run
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/drop-sample-mflix.ts --fix
 */
import { resolve } from "path";

import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

import {
    ensureMongoConnection,
    mongoose,
} from "../../packages/billing-connector/src/syncHistory/mongooseConnection";

const SAMPLE_DB = "sample_mflix";

async function main(): Promise<void> {
    const dryRun = process.argv.includes("--dry-run");
    const fix = process.argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }

    await ensureMongoConnection();
    const admin = mongoose.connection.db?.admin();
    if (!admin) {
        throw new Error("Mongo connection has no admin");
    }

    const { databases } = await admin.listDatabases();
    const sample = databases.find((d) => d.name === SAMPLE_DB);
    if (!sample) {
        console.log(`[drop-sample-mflix] ${SAMPLE_DB} not present`);
        return;
    }

    const sizeMB = +((sample.sizeOnDisk ?? 0) / 1024 / 1024).toFixed(2);
    console.log("[drop-sample-mflix] found", { db: SAMPLE_DB, sizeMB });

    if (dryRun) {
        console.log("[drop-sample-mflix] dry-run — re-run with --fix to drop");
        return;
    }

    await mongoose.connection.getClient().db(SAMPLE_DB).dropDatabase();
    const after = await admin.listDatabases();
    console.log(
        "[drop-sample-mflix] dropped; remaining DBs:",
        after.databases.map((d) => ({
            name: d.name,
            sizeMB: +((d.sizeOnDisk ?? 0) / 1024 / 1024).toFixed(2),
        }))
    );
}

main()
    .catch((err) => {
        console.error("[drop-sample-mflix] failed", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    });
