#!/usr/bin/env tsx
/**
 * Regenerates expected-results.xlsx from the in-memory timeline.
 * Do NOT run after changing KPI logic unless the product oracle intentionally changed —
 * the committed fixture matches the business Excel spec (customer 4567, Jan 2026).
 */
import path from "path";

import ExcelJS from "exceljs";

import {
    computeCustomerDailyKpiTimeline,
    goldenImportRowsToReplayInputs,
} from "@/server/services/import/goldenLoop/customerDailyKpiTimeline";
import {
    defaultGoldenFixturePaths,
    preprocessGoldenImportFiles,
} from "@/server/services/import/goldenLoop/preprocessGoldenImportFiles";

const FIXTURES_DIR = path.join(
    process.cwd(),
    "test/fixtures/import-golden-loop"
);

async function main(): Promise<void> {
    const fixtures = defaultGoldenFixturePaths(FIXTURES_DIR);
    const preprocessed = await preprocessGoldenImportFiles({
        invoicesPath: fixtures.invoicesPath,
        paymentsPath: fixtures.paymentsPath,
    });
    const replay = goldenImportRowsToReplayInputs(
        preprocessed.invoices,
        preprocessed.payments
    );
    const timeline = computeCustomerDailyKpiTimeline({
        accountId: 1,
        customerId: 4567,
        fromDate: "2026-01-01",
        toDate: "2026-01-27",
        invoices: replay.invoices,
        payments: replay.payments,
        config: { approvedLimit: 10_000 },
    });

    if (!fixtures.expectedResultsPath) {
        throw new Error("expected-results.xlsx path missing");
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(fixtures.expectedResultsPath);
    const worksheet = workbook.worksheets[0];
    const colIndex: Record<string, number> = {};
    worksheet.getRow(1).eachCell((cell, col) => {
        const key = String(cell.value ?? "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_");
        colIndex[key] = col;
    });

    for (let i = 0; i < timeline.snapshots.length; i++) {
        const snap = timeline.snapshots[i]!;
        const row = worksheet.getRow(i + 2);
        row.getCell(colIndex.date ?? 1).value = snap.date;
        row.getCell(colIndex.total_ar ?? 2).value = snap.totalAr;
        row.getCell(colIndex.term_breach ?? 3).value = snap.termBreach;
        row.getCell(colIndex.capacity ?? 4).value = snap.capacity;
        row.getCell(colIndex.not_insured ?? 5).value = snap.notInsured;
        const hiCol = colIndex.helth_index ?? colIndex.health_index ?? 6;
        row.getCell(hiCol).value =
            snap.healthIndex <= 1 ? snap.healthIndex * 100 : snap.healthIndex;
    }

    await workbook.xlsx.writeFile(fixtures.expectedResultsPath);
    console.log(`Updated ${fixtures.expectedResultsPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
