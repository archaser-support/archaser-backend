/**
 * Ops: force TIMEOUT on a stuck Mongo sync-history RUNNING row for one account.
 *
 * Use when a scheduled/worker sync is RUNNING for hours (heartbeats keep the
 * 2h idle sweeper from firing) and Nest cannot cancel because the run is not
 * in this process's in-memory registry.
 *
 * After TIMEOUT:
 * - The account mutex clears so the next due incremental can start.
 * - The worker stops within ~one heartbeat (~60s) once deployed code treats a
 *   failed touchProgress as cancel; otherwise restart the worker/cron process.
 *
 * Usage (from backend repo root, with MONGODB_URI for the target env):
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/timeout-stuck-running-sync.ts --account 10149 --dry-run
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/timeout-stuck-running-sync.ts --account 10149 --fix
 */
import { resolve } from "path";

import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

import {
    ensureMongoConnection,
    mongoose,
} from "../../packages/billing-connector/src/syncHistory/mongooseConnection";
import { markExecutionCancelled } from "../../packages/billing-connector/src/syncHistory/syncHistoryService";
import { ConnectorSyncExecutionModel } from "../../packages/billing-connector/src/syncHistory/model";

function parseArgs(argv: string[]): {
    accountId: number;
    dryRun: boolean;
    fix: boolean;
} {
    const dryRun = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }
    const accountFlag = argv.findIndex((a) => a === "--account");
    const accountRaw =
        accountFlag >= 0 ? argv[accountFlag + 1] : undefined;
    const accountId = Number.parseInt(String(accountRaw ?? ""), 10);
    if (!Number.isFinite(accountId) || accountId <= 0) {
        throw new Error("Pass --account <positive account id>");
    }
    return { accountId, dryRun, fix };
}

function maskMongoUri(uri: string): string {
    return uri.replace(
        /(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/,
        "$1***:***@"
    );
}

async function main(): Promise<void> {
    const { accountId, dryRun } = parseArgs(process.argv.slice(2));
    const mongoUri =
        process.env.MONGODB_URI || "mongodb://localhost:27017/archaser";

    console.log("[timeout-stuck-running-sync] starting", {
        accountId,
        mode: dryRun ? "dry-run" : "fix",
        mongoUri: maskMongoUri(mongoUri),
    });

    await ensureMongoConnection();

    const running = await ConnectorSyncExecutionModel.find({
        account_id: accountId,
        status: "RUNNING",
    })
        .sort({ started_at: -1 })
        .lean();

    console.log("[timeout-stuck-running-sync] found", {
        count: running.length,
        executions: running.map((doc) => ({
            execution_id: doc.execution_id,
            sync_mode: doc.sync_mode,
            trigger: doc.trigger,
            started_at: doc.started_at,
            last_progress_at: doc.last_progress_at,
            payment:
                (doc.entity_stats as { Payment?: { pulled?: number; success?: number } } | undefined)
                    ?.Payment ?? null,
        })),
    });

    if (running.length === 0) {
        console.log("[timeout-stuck-running-sync] nothing to do");
        return;
    }

    if (dryRun) {
        console.log(
            "[timeout-stuck-running-sync] dry-run complete — re-run with --fix to TIMEOUT"
        );
        return;
    }

    for (const doc of running) {
        const updated = await markExecutionCancelled(doc.execution_id, {
            errorMessage:
                "Sync stopped by operator (timeout-stuck-running-sync ops script)",
        });
        console.log("[timeout-stuck-running-sync] cancelled", {
            execution_id: doc.execution_id,
            ok: updated != null,
            status: updated?.status ?? null,
        });
    }
}

main()
    .catch((error) => {
        console.error("[timeout-stuck-running-sync] failed", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => undefined);
    });
