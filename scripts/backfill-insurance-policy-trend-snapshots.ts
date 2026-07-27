/**
 * Manual backfill for insurance policy trend daily snapshots.
 *
 * Usage:
 *   npx tsx scripts/backfill-insurance-policy-trend-snapshots.ts
 *   npx tsx scripts/backfill-insurance-policy-trend-snapshots.ts --date=2026-06-27
 *   npx tsx scripts/backfill-insurance-policy-trend-snapshots.ts --dry-run
 *
 * `--date` is UTC calendar date (YYYY-MM-DD). Defaults to today UTC.
 * Rerunning the same date upserts in place (no duplicate rows).
 */
import { resolve } from "path";

import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), "backend/.env.local") });
dotenv.config({ path: resolve(process.cwd(), "backend/.env") });

import { prisma } from "../frontend/lib/prisma";
import { takeInsurancePolicyTrendSnapshots } from "../frontend/server/services/creditInsurance/insurancePolicyTrendService";
import { startOfTodayUtc } from "../frontend/shared/creditInsurance/insurancePolicyLifecycle";

const dryRun = process.argv.includes("--dry-run");
const dateArg = process.argv.find((a) => a.startsWith("--date="));

function parseSnapshotDate(): Date {
    if (!dateArg) {
        return startOfTodayUtc();
    }
    const raw = dateArg.split("=")[1]?.trim() ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw new Error(`Invalid --date value "${raw}" (expected YYYY-MM-DD)`);
    }
    return new Date(`${raw}T00:00:00.000Z`);
}

async function main() {
    const snapshotDate = parseSnapshotDate();
    const dateLabel = snapshotDate.toISOString().slice(0, 10);

    const before = await prisma.$queryRaw<Array<{ c: number }>>`
        SELECT COUNT(*)::int AS c FROM "InsurancePolicyTrend"
        WHERE snapshot_date = ${snapshotDate}::date
    `;
    console.log(
        `InsurancePolicyTrend rows for ${dateLabel} before:`,
        before[0]?.c ?? 0
    );

    if (dryRun) {
        console.log("Dry run — skipping takeInsurancePolicyTrendSnapshots()");
        return;
    }

    const result = await takeInsurancePolicyTrendSnapshots({ snapshotDate });
    console.log("Snapshot result:", result);

    const after = await prisma.$queryRaw<Array<{ c: number }>>`
        SELECT COUNT(*)::int AS c FROM "InsurancePolicyTrend"
        WHERE snapshot_date = ${snapshotDate}::date
    `;
    console.log(
        `InsurancePolicyTrend rows for ${dateLabel} after:`,
        after[0]?.c ?? 0
    );
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
