/**
 * Delete billing-connector import-cache docs older than the configured TTL
 * (IMPORT_CACHE_TTL_SECONDS, currently 30 days) and recreate the Mongo TTL index
 * so Atlas keeps trimming going forward.
 *
 * Usage (from backend repo root):
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/purge-import-cache-older-than-ttl.ts --dry-run
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/purge-import-cache-older-than-ttl.ts --fix
 *
 * Optional:
 *   --days 30          Override retention days (default = IMPORT_CACHE_TTL_SECONDS)
 *   --skip-ttl-index   On --fix, delete only; do not drop/recreate the TTL index
 */
import { resolve } from "path";

import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

import { IMPORT_CACHE_TTL_SECONDS } from "../../packages/billing-connector/src/importCache/types";
import {
    ensureMongoConnection,
    mongoose,
} from "../../packages/billing-connector/src/syncHistory/mongooseConnection";

const COLLECTION = "connector_import_entity_cache";
const TTL_INDEX_NAME = "created_at_1";

function parseArgs(argv: string[]): {
    dryRun: boolean;
    fix: boolean;
    days: number;
    skipTtlIndex: boolean;
} {
    const dryRun = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }

    const daysIdx = argv.indexOf("--days");
    const daysRaw =
        daysIdx === -1 ? undefined : Number(argv[daysIdx + 1]);
    const defaultDays = Math.round(IMPORT_CACHE_TTL_SECONDS / (24 * 60 * 60));
    const days =
        daysRaw === undefined || Number.isNaN(daysRaw) ? defaultDays : daysRaw;
    if (!Number.isInteger(days) || days <= 0) {
        throw new Error("--days must be a positive integer");
    }

    return {
        dryRun,
        fix,
        days,
        skipTtlIndex: argv.includes("--skip-ttl-index"),
    };
}

function maskMongoUri(uri: string): string {
    return uri.replace(
        /(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/,
        "$1***:***@"
    );
}

async function ensureTtlIndex(
    collection: mongoose.mongo.Collection
): Promise<void> {
    const indexes = await collection.indexes();
    const existingTtl = indexes.find((idx) => idx.name === TTL_INDEX_NAME);
    if (
        existingTtl &&
        existingTtl.expireAfterSeconds === IMPORT_CACHE_TTL_SECONDS
    ) {
        console.log("[purge-import-cache] TTL index already correct", {
            name: TTL_INDEX_NAME,
            expireAfterSeconds: existingTtl.expireAfterSeconds,
        });
        return;
    }

    if (existingTtl) {
        console.log("[purge-import-cache] dropping TTL index", {
            name: TTL_INDEX_NAME,
            expireAfterSeconds: existingTtl.expireAfterSeconds,
        });
        await collection.dropIndex(TTL_INDEX_NAME);
    }

    // Prefer createIndex over Model.syncIndexes — lighter and avoids createCollection writes.
    await collection.createIndex(
        { created_at: 1 },
        {
            name: TTL_INDEX_NAME,
            expireAfterSeconds: IMPORT_CACHE_TTL_SECONDS,
        }
    );
    const after = await collection.indexes();
    const recreated = after.find((idx) => idx.name === TTL_INDEX_NAME);
    console.log("[purge-import-cache] TTL index ready", {
        name: TTL_INDEX_NAME,
        expireAfterSeconds: recreated?.expireAfterSeconds,
        expectedSeconds: IMPORT_CACHE_TTL_SECONDS,
    });
}

async function main(): Promise<void> {
    const { dryRun, days, skipTtlIndex } = parseArgs(process.argv.slice(2));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filter = { created_at: { $lt: cutoff } };

    const mongoUri =
        process.env.MONGODB_URI || "mongodb://localhost:27017/archaser";
    console.log("[purge-import-cache] starting", {
        mode: dryRun ? "dry-run" : "fix",
        days,
        cutoff: cutoff.toISOString(),
        collection: COLLECTION,
        mongoUri: maskMongoUri(mongoUri),
        recreateTtlIndex: !dryRun && !skipTtlIndex,
    });

    await ensureMongoConnection();
    const collection = mongoose.connection.collection(COLLECTION);

    const [totalCount, staleCount, sample] = await Promise.all([
        collection.estimatedDocumentCount(),
        collection.countDocuments(filter),
        collection
            .find(filter, {
                projection: {
                    _id: 1,
                    account_id: 1,
                    import_type: 1,
                    cache_day: 1,
                    execution_id: 1,
                    created_at: 1,
                    row_count: 1,
                },
            })
            .sort({ created_at: 1 })
            .limit(5)
            .toArray(),
    ]);

    console.log("[purge-import-cache] counts", {
        estimatedTotal: totalCount,
        olderThanCutoff: staleCount,
        keepApprox: Math.max(0, totalCount - staleCount),
    });

    if (sample.length > 0) {
        console.log(
            "[purge-import-cache] oldest matching samples:",
            sample.map((doc) => ({
                account_id: doc.account_id,
                import_type: doc.import_type,
                cache_day: doc.cache_day,
                execution_id: doc.execution_id,
                row_count: doc.row_count,
                created_at: doc.created_at,
            }))
        );
    }

    if (dryRun) {
        console.log(
            "[purge-import-cache] dry-run complete — re-run with --fix to delete"
        );
        return;
    }

    if (staleCount === 0) {
        console.log("[purge-import-cache] nothing to delete");
    } else {
        const result = await collection.deleteMany(filter);
        console.log("[purge-import-cache] deleted", {
            deletedCount: result.deletedCount,
        });
    }

    if (!skipTtlIndex) {
        await ensureTtlIndex(collection);
    }

    const remaining = await collection.estimatedDocumentCount();
    console.log("[purge-import-cache] done", { remainingApprox: remaining });
}

main()
    .catch((err) => {
        console.error("[purge-import-cache] failed", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    });
