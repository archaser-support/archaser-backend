#!/usr/bin/env tsx

/**
 * Smoke entry point for golden import file preprocessing.
 *
 * Usage:
 *   npx tsx scripts/testing/preprocess-golden-import.ts
 *   npx tsx scripts/testing/preprocess-golden-import.ts --fixtures-dir /path/to/fixtures
 */

import {
    defaultGoldenFixturePaths,
    preprocessGoldenImportFiles,
} from "@/server/services/import/goldenLoop/preprocessGoldenImportFiles";

function readFixturesDirArg(): string | undefined {
    const flagIndex = process.argv.indexOf("--fixtures-dir");
    if (flagIndex === -1) {
        return undefined;
    }
    return process.argv[flagIndex + 1];
}

async function main(): Promise<void> {
    const fixturesDir = readFixturesDirArg();
    const paths = defaultGoldenFixturePaths(fixturesDir);
    const result = await preprocessGoldenImportFiles(paths);

    console.log(
        JSON.stringify(
            {
                customerNumber: result.customerNumber,
                invoiceCount: result.invoices.length,
                paymentCount: result.payments.length,
                sampleInvoice: result.invoices[0] ?? null,
                samplePayment: result.payments[0] ?? null,
            },
            null,
            2
        )
    );

    const allCustomerNumbers = new Set([
        ...result.invoices.map((row) => row.customer_number),
        ...result.payments.map((row) => row.customer_number),
    ]);

    if (allCustomerNumbers.size !== 1 || !allCustomerNumbers.has("4567")) {
        console.error("PREREQ_FAILED: expected customer_number 4567 on every row");
        process.exit(1);
    }

    const invoice5584561 = result.invoices.find(
        (row) => row.invoice_number === "5584561"
    );
    const payment5584561 = result.payments.find(
        (row) => row.invoice_number === "5584561"
    );

    if (invoice5584561?.invoice_date !== "2026-01-01") {
        console.error("MISMATCH: invoice 5584561 invoice_date", invoice5584561?.invoice_date);
        process.exit(1);
    }

    if (payment5584561?.payment_date !== "2026-01-03") {
        console.error("MISMATCH: payment on 5584561 payment_date", payment5584561?.payment_date);
        process.exit(1);
    }

    process.exit(0);
}

main().catch((error) => {
    console.error("IMPORT_FAILED:", error instanceof Error ? error.message : error);
    process.exit(1);
});
