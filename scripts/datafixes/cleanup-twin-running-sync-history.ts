/**
 * Deploy-safe cleanup of twin RUNNING sync-history rows, then ensure the
 * partial unique index `uniq_account_running_sync` (one RUNNING per account).
 *
 * When to run (ops):
 *   Once per environment after deploying the one-RUNNING-per-account mutex
 *   (slice 01), before or right after traffic hits the new code. Prefer
 *   --dry-run first in production, then --fix. Safe to re-run anytime
 *   (no-op when no twins remain; index create is idempotent).
 *
 * Automatic path:
 *   The mongoose sync-history store also runs the same cleanup+index ensure
 *   once on first Mongo use after process start (same pattern as import-cache
 *   index ensure). This script is the explicit ops / dry-run path.
 *
 * Usage (from backend repo root):
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/cleanup-twin-running-sync-history.ts --dry-run
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/cleanup-twin-running-sync-history.ts --fix
 *
 * Optional:
 *   --skip-index   On --fix, cleanup twins only; do not create the unique index
 */
import { resolve } from "path";

import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

import {
    ensureUniqueRunningSyncMutex,
    TWIN_RUNNING_CLEANUP_ERROR_MESSAGE,
} from "../../packages/billing-connector/src/syncHistory/ensureUniqueRunningMutex";
import {
    ensureMongoConnection,
    mongoose,
} from "../../packages/billing-connector/src/syncHistory/mongooseConnection";
import { ACCOUNT_RUNNING_UNIQUE_INDEX_NAME } from "../../packages/billing-connector/src/syncHistory/syncAlreadyRunningError";

function parseArgs(argv: string[]): {
    dryRun: boolean;
    fix: boolean;
    skipIndex: boolean;
} {
    const dryRun = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }
    return {
        dryRun,
        fix,
        skipIndex: argv.includes("--skip-index"),
    };
}

function maskMongoUri(uri: string): string {
    return uri.replace(
        /(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/,
        "$1***:***@"
    );
}

async function main(): Promise<void> {
    const { dryRun, skipIndex } = parseArgs(process.argv.slice(2));
    const mongoUri =
        process.env.MONGODB_URI || "mongodb://localhost:27017/archaser";

    console.log("[cleanup-twin-running-sync] starting", {
        mode: dryRun ? "dry-run" : "fix",
        skipIndex: !dryRun && skipIndex,
        indexName: ACCOUNT_RUNNING_UNIQUE_INDEX_NAME,
        twinTimeoutMessage: TWIN_RUNNING_CLEANUP_ERROR_MESSAGE,
        mongoUri: maskMongoUri(mongoUri),
    });

    await ensureMongoConnection();

    const result = await ensureUniqueRunningSyncMutex({
        dryRun,
        skipIndex: dryRun ? true : skipIndex,
    });

    console.log("[cleanup-twin-running-sync] cleanup", {
        accountsWithTwins: result.cleanup.accountsWithTwins,
        twinDocsTimedOut: result.cleanup.twinDocsTimedOut,
        keptExecutionIds: result.cleanup.keptExecutionIds,
        dryRun,
    });

    if (dryRun) {
        console.log(
            "[cleanup-twin-running-sync] dry-run complete — re-run with --fix to TIMEOUT twins and ensure index"
        );
        return;
    }

    console.log("[cleanup-twin-running-sync] index", {
        ensured: result.indexEnsured,
        name: ACCOUNT_RUNNING_UNIQUE_INDEX_NAME,
        skipped: skipIndex,
    });

    console.log("[cleanup-twin-running-sync] done");
}

main()
    .catch((err) => {
        console.error("[cleanup-twin-running-sync] failed", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    });
