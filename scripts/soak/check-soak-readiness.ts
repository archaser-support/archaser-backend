#!/usr/bin/env npx tsx
/**
 * Soak readiness gate (local/CI — does not flip production).
 *
 * Usage (from backend root):
 *   npx tsx scripts/soak/check-soak-readiness.ts
 *   npx tsx scripts/soak/check-soak-readiness.ts --worker-url http://127.0.0.1:3003
 *   npx tsx scripts/soak/check-soak-readiness.ts --allow-path-flips-on
 *
 * Exit codes:
 *   0 = cutover templates OK (handlers covered; staging+prod peels expected active)
 *   1 = blocked (missing handlers or unexpected flip state)
 */
import * as fs from "fs";
import * as path from "path";
import {
    WORKER_SOAK_KNOWN_GAPS,
    assessCronHandlerCoverage,
    readPathFlipEnv,
} from "../../packages/cron-jobs/src/soakCatalog";

type Args = {
    workerUrl?: string;
    allowPathFlipsOn: boolean;
};

function parseArgs(argv: string[]): Args {
    const args: Args = { allowPathFlipsOn: false };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === "--worker-url") {
            args.workerUrl = argv[i + 1];
            i += 1;
        } else if (a === "--allow-path-flips-on") {
            args.allowPathFlipsOn = true;
        }
    }
    return args;
}

function nginxFlipActive(confPath: string, marker: string): boolean | null {
    if (!fs.existsSync(confPath)) {
        return null;
    }
    const text = fs.readFileSync(confPath, "utf8");
    const lines = text.split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) {
            continue;
        }
        if (trimmed.includes(marker)) {
            return true;
        }
    }
    return false;
}

async function checkWorkerHealth(url: string): Promise<{
    ok: boolean;
    detail: string;
}> {
    try {
        const res = await fetch(`${url.replace(/\/$/, "")}/health`);
        const body = (await res.json()) as { status?: string; service?: string };
        if (!res.ok) {
            return { ok: false, detail: `HTTP ${res.status}` };
        }
        if (body.status !== "ok") {
            return { ok: false, detail: JSON.stringify(body) };
        }
        return {
            ok: true,
            detail: `service=${body.service ?? "unknown"}`,
        };
    } catch (error) {
        return {
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const backendRoot = path.resolve(__dirname, "../..");
    let blocked = false;

    console.log("=== Archaser soak readiness ===\n");

    // --- Worker handler coverage ---
    const coverage = assessCronHandlerCoverage();
    console.log(
        `Worker CronJob handlers: ${coverage.ported.length} ported, ${coverage.missing.length} missing`
    );
    if (!coverage.ok) {
        blocked = true;
        console.log("  BLOCK: missing handlers:");
        for (const name of coverage.missing) {
            console.log(`    - ${name}`);
        }
    } else {
        console.log("  OK: all expected CronJob names have Nest handlers");
    }

    console.log("\nKnown soak gaps (do not block this gate):");
    for (const gap of WORKER_SOAK_KNOWN_GAPS) {
        console.log(`  [${gap.severity}] ${gap.name}: ${gap.gap}`);
    }

    // --- Path flip env (local Next) ---
    // After cutover, local USE_*_NEST_REWRITE=true is fine for peel-local dev.
    console.log("\nPath-flip env (Next local rewrites):");
    const flips = readPathFlipEnv(process.env);
    for (const flag of flips) {
        const state = flag.enabled ? "ON" : "off";
        console.log(`  ${flag.envVar}=${state} (${flag.description})`);
    }

    // --- nginx configs ---
    // Staging + production peels are flipped in-repo (SMS / narrow connectors / reports).
    // Amplify UI redirect is staging-only; production UI stays on EC2 Next.
    console.log("\nnginx path-flip locations (repo templates):");
    for (const confName of [
        "nginx/archaser-staging.conf",
        "nginx/archaser-production.conf",
    ]) {
        const confPath = path.join(backendRoot, confName);
        for (const flag of flips) {
            const active = nginxFlipActive(confPath, flag.nginxMarker);
            if (active === null) {
                console.log(`  ${confName}: missing file`);
                break;
            }
            const label = active ? "ACTIVE" : "commented";
            console.log(`  ${confName} ${flag.id}: ${label}`);
            if (active) {
                console.log("    OK: peel flipped in repo template");
            } else {
                blocked = true;
                console.log(
                    "    BLOCK: peel not active — expected flipped after cutover"
                );
            }
        }
    }

    // Connectors workers: compose sets true on connectors service after flip
    const connectorsWorkers =
        process.env.ENABLE_CONNECTORS_SYNC_WORKERS === "true";
    console.log(
        `\nENABLE_CONNECTORS_SYNC_WORKERS=${connectorsWorkers ? "true" : "false"} (compose sets true on connectors service)`
    );

    console.log(
        "\nCron: worker owns schedules via BullMQ; Lambda /api/system/cron endpoint removed"
    );

    // --- Optional worker health ---
    if (args.workerUrl) {
        console.log(`\nWorker health (${args.workerUrl}):`);
        const health = await checkWorkerHealth(args.workerUrl);
        console.log(`  ${health.ok ? "OK" : "WARN"} ${health.detail}`);
        if (!health.ok) {
            console.log(
                "  (non-blocking if worker is not running locally; start worker for live soak)"
            );
        }
    } else {
        console.log(
            "\nWorker health: skipped (pass --worker-url http://127.0.0.1:3003)"
        );
    }

    console.log("\n=== Deploy cutover checklist ===");
    console.log("1. Redeploy compose (connectors workers on; worker owns cron schedules; Lambda endpoint removed)");
    console.log("2. Reload nginx from repo templates (staging + production peels)");
    console.log("3. Staging UI: Amplify redirect + NEST_CORS_ORIGINS includes Amplify origin");
    console.log("4. Production UI: remains EC2 Next (Amplify prod cutover optional)");
    console.log("5. Confirm worker CronJobExecution + peel smoke (sms/accounts/reports)");
    console.log("6. Known gaps accepted: email SMTP stub, AWM template/schedule extras");
    console.log("7. After prod: delete EventBridge + cron Lambda; scrub CRON_SECRET / ENABLE_CRON_JOBS from host env");

    if (blocked) {
        console.log("\nRESULT: BLOCKED — fix issues above before declaring cutover complete");
        process.exit(1);
    }
    console.log("\nRESULT: CUTOVER TEMPLATES READY (deploy + reload nginx on hosts)");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
