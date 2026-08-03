#!/usr/bin/env tsx

/**
 * Golden import harness — E2E validation of deferred-payment + chronological AR import.
 *
 * Authenticates against local dev, validates prerequisites, manages customer checkpoint
 * save/restore, imports golden payment + invoice fixtures via production APIs, compares
 * 27-day KPI timeline against expected-results.xlsx, and exits 0 (match) or 1 (failure).
 *
 * Usage:
 *   npx tsx scripts/testing/run-golden-import-harness.ts
 *   npx tsx scripts/testing/run-golden-import-harness.ts --fixtures-dir /path/to/fixtures
 *   npx tsx scripts/testing/run-golden-import-harness.ts --customer-number 4567
 *
 * Environment:
 *   TEST_EMAIL / TEST_PASSWORD — credentials (default: admin@example.com / password)
 *   NEXTAUTH_URL — base URL (default: http://localhost:3000)
 *
 * Cursor /loop workflow:
 *   1. Run this harness after code changes to import/replay/KPI logic.
 *   2. Exit 0 → golden timeline matches; stop.
 *   3. Exit 1 → read stderr sections (PREREQ_FAILED | IMPORT_FAILED | MISMATCH),
 *      fix application code only (not fixtures or tolerances), re-run harness.
 *   4. After 10 failed agent iterations, escalate to a human with the printed diff.
 *
 * Prerequisites (local dev):
 *   - Next.js server running (NODE_ENV !== production)
 *   - Account: has_credit_insurance + enable_customer_checkpoints
 *   - Account balance_evaluation_method = Payment-Based (payments imported separately)
 *   - Customer 4567 with active policy approved_limit = 10,000
 */

import { ImportType } from "@prisma/client";
import type { AxiosInstance } from "axios";

import { prisma } from "@/lib/prisma";
import { CustomerCheckpointService } from "@/server/services/customerCheckpoint/CustomerCheckpointService";
import {
    checkpointHasArData,
    type CustomerCheckpointRowCounts,
    type CustomerCheckpointStatus,
} from "@/server/services/customerCheckpoint/types";
import {
    computeCustomerDailyKpiTimeline,
    computeCustomerDailyKpiTimelineFromDb,
    goldenImportRowsToReplayInputs,
} from "@/server/services/import/goldenLoop/customerDailyKpiTimeline";
import {
    compareGoldenKpiTimeline,
    loadGoldenExpectedKpiRows,
} from "@/server/services/import/goldenLoop/goldenKpiComparator";
import { logGoldenEventKpiMatrix } from "@/server/services/import/goldenLoop/goldenKpiEventLog";
import {
    defaultGoldenFixturePaths,
    preprocessGoldenImportFiles,
} from "@/server/services/import/goldenLoop/preprocessGoldenImportFiles";
import {
    GOLDEN_LOOP_DEFAULT_CUSTOMER_NUMBER,
    type GoldenInvoiceImportRow,
    type GoldenPaymentImportRow,
} from "@/server/services/import/goldenLoop/types";

import { authenticateUser, type AuthSession } from "./auth-helper";

const GOLDEN_FROM_DATE = "2026-01-01";
const GOLDEN_TO_DATE = "2026-01-27";
const GOLDEN_APPROVED_LIMIT = 10_000;
const BATCH_SIZE = 50;
const RUN_ID = `golden-${Date.now()}`;

type HarnessConfig = {
    fixturesDir?: string;
    customerNumber: string;
    email: string;
    password: string;
    fromDate: string;
    toDate: string;
    eventKpiLog: boolean;
};

type PrerequisiteResult =
    | { ok: true; customerId: number; accountId: number }
    | { ok: false; instructions: string };

function printHelp(): void {
    console.log(`Golden import harness

Usage:
  npx tsx scripts/testing/run-golden-import-harness.ts [options]

Options:
  --fixtures-dir <path>     Fixture directory (default: test/fixtures/import-golden-loop)
  --customer-number <num>   Target customer number (default: ${GOLDEN_LOOP_DEFAULT_CUSTOMER_NUMBER})
  --from-date <YYYY-MM-DD>  Timeline start (default: ${GOLDEN_FROM_DATE})
  --to-date <YYYY-MM-DD>    Timeline end (default: ${GOLDEN_TO_DATE})
  --email <email>           Login email (default: TEST_EMAIL or admin@example.com)
  --password <password>     Login password (default: TEST_PASSWORD or password)
  --event-kpi-log           After each replayed invoice/payment, log KPI matrix vs expected-results.xlsx
  --help                    Show this help

Exit codes:
  0 — all expected KPI days match
  1 — prerequisite failure, import failure, or KPI mismatch

Cursor /loop:
  Re-run this harness on non-zero exit after fixing import/replay/KPI application code.
  Max 10 automatic agent retries, then escalate with the MISMATCH diff.
`);
}

function parseArgs(): HarnessConfig | null {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
        printHelp();
        return null;
    }

    const config: HarnessConfig = {
        customerNumber: GOLDEN_LOOP_DEFAULT_CUSTOMER_NUMBER,
        email: process.env.TEST_EMAIL || "admin@example.com",
        password: process.env.TEST_PASSWORD || "password",
        fromDate: GOLDEN_FROM_DATE,
        toDate: GOLDEN_TO_DATE,
        eventKpiLog: false,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];
        switch (arg) {
            case "--fixtures-dir":
                if (next) config.fixturesDir = next;
                break;
            case "--customer-number":
                if (next) config.customerNumber = next;
                break;
            case "--from-date":
                if (next) config.fromDate = next;
                break;
            case "--to-date":
                if (next) config.toDate = next;
                break;
            case "--email":
                if (next) config.email = next;
                break;
            case "--password":
                if (next) config.password = next;
                break;
            case "--event-kpi-log":
                config.eventKpiLog = true;
                break;
        }
    }

    return config;
}

function failPrereq(message: string): never {
    console.error("PREREQ_FAILED:", message);
    process.exit(1);
}

function failImport(message: string): never {
    console.error("IMPORT_FAILED:", message);
    process.exit(1);
}

function failMismatch(message: string): never {
    console.error("MISMATCH:", message);
    process.exit(1);
}

async function validatePrerequisites(
    accountId: number,
    customerNumber: string
): Promise<PrerequisiteResult> {
    if (process.env.NODE_ENV === "production") {
        return {
            ok: false,
            instructions:
                "NODE_ENV is production. Run the harness against local dev (NODE_ENV=development).",
        };
    }

    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: {
            id: true,
            has_credit_insurance: true,
            enable_customer_checkpoints: true,
            balance_evaluation_method: true,
        },
    });

    if (!account) {
        return {
            ok: false,
            instructions: `Account ${accountId} not found.`,
        };
    }

    if (!account.has_credit_insurance) {
        return {
            ok: false,
            instructions:
                "Enable credit insurance on the account (Account Details → has_credit_insurance).",
        };
    }

    if (!account.enable_customer_checkpoints) {
        return {
            ok: false,
            instructions:
                "Enable customer checkpoints on the account (Account Details → enable_customer_checkpoints).",
        };
    }

    if (account.balance_evaluation_method !== "Payment-Based") {
        return {
            ok: false,
            instructions:
                `Account balance_evaluation_method is "${account.balance_evaluation_method ?? "Invoice-Based"}"; expected "Payment-Based" so invoice import does not auto-create payments (payments are imported separately).`,
        };
    }

    const customer = await prisma.customer.findFirst({
        where: {
            account_id: accountId,
            customer_number: customerNumber,
        },
        select: { id: true },
    });

    if (!customer) {
        return {
            ok: false,
            instructions: `Customer ${customerNumber} not found for account ${accountId}. Create the golden customer with customer_number ${customerNumber}.`,
        };
    }

    const activePolicy = await prisma.customerPolicy.findFirst({
        where: {
            customer_id: customer.id,
            is_active: true,
        },
        select: { approved_limit: true },
        orderBy: { id: "desc" },
    });

    if (!activePolicy) {
        return {
            ok: false,
            instructions: `Customer ${customerNumber} has no active CustomerPolicy. Add a policy with approved_limit ${GOLDEN_APPROVED_LIMIT}.`,
        };
    }

    const approvedLimit = Number(activePolicy.approved_limit ?? 0);
    if (approvedLimit !== GOLDEN_APPROVED_LIMIT) {
        return {
            ok: false,
            instructions: `Customer ${customerNumber} active policy approved_limit is ${approvedLimit}; expected ${GOLDEN_APPROVED_LIMIT}.`,
        };
    }

    return {
        ok: true,
        customerId: customer.id,
        accountId,
    };
}

function checkpointUrl(
    customerId: number,
    action?: "save" | "restore"
): string {
    const suffix =
        action === "save" ? "/save" : action === "restore" ? "/restore" : "";
    return `/api/customers/_/checkpoint${suffix}?customer_id=${customerId}`;
}

async function fetchCheckpointStatus(
    client: AxiosInstance,
    customerId: number
): Promise<CustomerCheckpointStatus | null> {
    try {
        const response = await client.get(checkpointUrl(customerId));
        if (response.status !== 200) {
            const data = response.data as { error?: string };
            throw new Error(
                data.error || `Checkpoint status HTTP ${response.status}`
            );
        }
        return response.data as CustomerCheckpointStatus;
    } catch (error: unknown) {
        const status = (error as { response?: { status?: number } })?.response
            ?.status;
        if (status === 404) {
            return null;
        }
        throw error;
    }
}

async function saveCheckpoint(
    client: AxiosInstance,
    customerId: number
): Promise<void> {
    const response = await client.post(
        `${checkpointUrl(customerId, "save")}&require_empty_ar_baseline=true`
    );
    if (response.status !== 200) {
        const data = response.data as { error?: string };
        throw new Error(data.error || `Checkpoint save HTTP ${response.status}`);
    }
}

async function restoreCheckpoint(
    client: AxiosInstance,
    customerId: number
): Promise<void> {
    const response = await client.post(checkpointUrl(customerId, "restore"));
    if (response.status !== 200) {
        const data = response.data as { error?: string };
        throw new Error(data.error || `Checkpoint restore HTTP ${response.status}`);
    }
}

function assertEmptyArBaseline(
    counts: { invoices: number; invoicePayments: number },
    context: string
): void {
    if (counts.invoices > 0 || counts.invoicePayments > 0) {
        throw new Error(
            `${context}: expected 0 invoices and 0 invoice payments, found ${counts.invoices} invoices and ${counts.invoicePayments} invoice payments`
        );
    }
}

async function resetPollutedCheckpointBaseline(
    customerId: number,
    rowCounts: CustomerCheckpointRowCounts
): Promise<void> {
    console.log(
        `[${RUN_ID}] Checkpoint baseline contains AR data (${rowCounts.invoices} invoices, ${rowCounts.invoicePayments} invoice payments) — resetting`
    );
    const checkpointService = CustomerCheckpointService.getInstance();
    await checkpointService.deleteCustomerCheckpoint(customerId);
    await checkpointService.clearCustomerArData(customerId);
    const { CustomerService } = await import("@/server/services/CustomerService");
    await CustomerService.recalculateAllAmountsForCustomers([customerId]);
}

async function ensureGoldenBaseline(
    client: AxiosInstance,
    customerId: number
): Promise<void> {
    const checkpointService = CustomerCheckpointService.getInstance();
    const status = await fetchCheckpointStatus(client, customerId);

    if (
        status?.exists &&
        status.rowCounts &&
        checkpointHasArData(status.rowCounts)
    ) {
        await resetPollutedCheckpointBaseline(customerId, status.rowCounts);
    }

    const refreshedStatus = await fetchCheckpointStatus(client, customerId);

    if (refreshedStatus?.exists) {
        console.log(`[${RUN_ID}] Restoring customer checkpoint`);
        await restoreCheckpoint(client, customerId);
        const afterRestore = await checkpointService.countCustomerArRows(
            customerId
        );
        assertEmptyArBaseline(
            afterRestore,
            "After checkpoint restore, customer AR must be empty"
        );
        return;
    }

    const beforeSave = await checkpointService.countCustomerArRows(customerId);
    assertEmptyArBaseline(
        beforeSave,
        "Before first baseline save, customer AR must be empty"
    );

    console.log(`[${RUN_ID}] Saving baseline customer checkpoint`);
    await saveCheckpoint(client, customerId);

    const savedStatus = await fetchCheckpointStatus(client, customerId);
    if (
        savedStatus?.rowCounts &&
        checkpointHasArData(savedStatus.rowCounts)
    ) {
        throw new Error(
            "Saved checkpoint still contains invoice or payment data"
        );
    }
}

async function resolveAccountId(session: AuthSession): Promise<number> {
    for (const path of ["/api/test-auth/session", "/api/auth/session"]) {
        try {
            const response = await session.client.get(path);
            const accountId = response.data?.user?.account_id;
            if (typeof accountId === "number" && Number.isFinite(accountId)) {
                return accountId;
            }
        } catch {
            // try next endpoint
        }
    }

    const user = await prisma.user.findFirst({
        where: { email: session.email },
        select: { account_id: true },
    });
    if (user?.account_id) {
        return user.account_id;
    }

    throw new Error("Could not resolve account_id from authenticated session");
}

async function createImportJob(
    client: AxiosInstance,
    importType: ImportType,
    totalRecords: number
): Promise<string> {
    const response = await client.post("/api/import/job/create", {
        import_type: importType,
        total_records: totalRecords,
        metadata: { source: "golden-harness", runId: RUN_ID },
    });

    if (response.status !== 201 || !response.data?.jobId) {
        throw new Error(
            `Failed to create import job: ${response.status} ${JSON.stringify(response.data)}`
        );
    }

    return response.data.jobId as string;
}

async function uploadImportBatches(
    client: AxiosInstance,
    endpoint: string,
    jobId: string,
    payloadKey: "payments" | "invoices",
    records: Record<string, unknown>[]
): Promise<void> {
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE);
        const response = await client.post(endpoint, {
            jobId,
            batchIndex,
            globalStartIndex: i,
            [payloadKey]: batch,
        });

        if (response.status !== 200 && response.status !== 201) {
            throw new Error(
                `${payloadKey} batch ${batchIndex + 1} failed: ${response.status} ${JSON.stringify(response.data)}`
            );
        }

        const results = (response.data?.results ?? []) as Array<{
            success?: boolean;
            error?: string;
            message?: string;
        }>;
        const failures = results.filter((row) => row.success === false);
        if (failures.length > 0) {
            const sample = failures
                .slice(0, 3)
                .map((row) => row.error || row.message || "unknown")
                .join("; ");
            throw new Error(
                `${payloadKey} batch ${batchIndex + 1}: ${failures.length} row failures — ${sample}`
            );
        }
    }
}

async function completeImportJob(
    client: AxiosInstance,
    jobId: string,
    affectedCustomerIds?: number[]
): Promise<void> {
    const body: { jobId: string; affectedCustomerIds?: number[] } = { jobId };
    if (affectedCustomerIds?.length) {
        body.affectedCustomerIds = affectedCustomerIds;
    }

    const response = await client.post("/api/import/job/complete", body);
    if (response.status !== 200) {
        throw new Error(
            `Job complete failed: ${response.status} ${JSON.stringify(response.data)}`
        );
    }
}

function invoiceRowForImport(row: GoldenInvoiceImportRow): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        customer_number: row.customer_number,
        invoice_number: row.invoice_number,
        invoice_date: row.invoice_date,
        amount: row.amount,
        customer_amount: row.customer_amount,
        customer_currency: row.customer_currency,
    };

    if (row.due_date) {
        payload.due_date = row.due_date;
    } else {
        const [year, month, day] = row.invoice_date.split("-").map(Number);
        const due = new Date(year, month - 1, day);
        due.setDate(due.getDate() + 42);
        payload.due_date = due.toISOString().slice(0, 10);
    }

    if (row.total_paid !== undefined) {
        payload.total_paid = row.total_paid;
    }
    if (row.customer_total_paid !== undefined) {
        payload.customer_total_paid = row.customer_total_paid;
    }

    return payload;
}

function paymentRowForImport(row: GoldenPaymentImportRow): Record<string, unknown> {
    return {
        customer_number: row.customer_number,
        invoice_number: row.invoice_number,
        payment_date: row.payment_date,
        customer_amount: row.customer_amount,
        customer_currency: row.customer_currency,
        reference: row.reference,
        ...(row.amount !== undefined ? { amount: row.amount } : {}),
        ...(row.payment_method ? { payment_method: row.payment_method } : {}),
    };
}

async function runGoldenImports(
    session: AuthSession,
    customerId: number,
    payments: GoldenPaymentImportRow[],
    invoices: GoldenInvoiceImportRow[]
): Promise<void> {
    const client = session.client;

    const paymentJobId = await createImportJob(
        client,
        ImportType.Payment,
        payments.length
    );
    await uploadImportBatches(
        client,
        "/api/import/payment",
        paymentJobId,
        "payments",
        payments.map(paymentRowForImport)
    );
    await completeImportJob(client, paymentJobId);

    const invoiceJobId = await createImportJob(
        client,
        ImportType.Invoice,
        invoices.length
    );
    await uploadImportBatches(
        client,
        "/api/import/invoice",
        invoiceJobId,
        "invoices",
        invoices.map(invoiceRowForImport)
    );
    await completeImportJob(client, invoiceJobId, [customerId]);
}

async function main(): Promise<void> {
    const config = parseArgs();
    if (!config) {
        process.exit(0);
    }

    console.log(`[${RUN_ID}] Golden import harness starting`);

    const session = await authenticateUser(
        config.email,
        config.password,
        RUN_ID,
        "golden-harness"
    );

    let accountId: number;
    try {
        accountId = await resolveAccountId(session);
    } catch (error) {
        failPrereq(
            error instanceof Error ? error.message : "Could not resolve account"
        );
    }

    const prereq = await validatePrerequisites(accountId, config.customerNumber);
    if (!prereq.ok) {
        console.error("PREREQ_FAILED:", prereq.instructions);
        console.error(
            "\nSetup checklist:\n" +
                "  1. Local dev server running (NODE_ENV !== production)\n" +
                `  2. Customer ${config.customerNumber} exists on account ${accountId}\n` +
                `  3. Active CustomerPolicy with approved_limit ${GOLDEN_APPROVED_LIMIT}\n` +
                "  4. Account has_credit_insurance enabled\n" +
                "  5. Account enable_customer_checkpoints enabled\n" +
                "  6. Account balance_evaluation_method = Payment-Based"
        );
        process.exit(1);
    }

    const { customerId } = prereq;
    const fixturePaths = defaultGoldenFixturePaths(config.fixturesDir);

    let preprocessed;
    try {
        preprocessed = await preprocessGoldenImportFiles(fixturePaths, {
            targetCustomerNumber: config.customerNumber,
        });
    } catch (error) {
        failImport(
            error instanceof Error ? error.message : "Fixture preprocessing failed"
        );
    }

    if (!fixturePaths.expectedResultsPath) {
        failPrereq("expected-results.xlsx path is missing from fixture config");
    }

    try {
        await ensureGoldenBaseline(session.client, customerId);
    } catch (error) {
        failImport(
            error instanceof Error ? error.message : "Checkpoint operation failed"
        );
    }

    try {
        console.log(
            `[${RUN_ID}] Importing ${preprocessed.payments.length} payments, ${preprocessed.invoices.length} invoices`
        );
        await runGoldenImports(
            session,
            customerId,
            preprocessed.payments,
            preprocessed.invoices
        );
    } catch (error) {
        failImport(
            error instanceof Error ? error.message : "Import job failed"
        );
    }

    let expectedRows;
    try {
        expectedRows = await loadGoldenExpectedKpiRows(
            fixturePaths.expectedResultsPath
        );
    } catch (error) {
        failImport(
            error instanceof Error
                ? error.message
                : "Failed to load expected-results.xlsx"
        );
    }

    if (config.eventKpiLog) {
        const replayInputs = goldenImportRowsToReplayInputs(
            preprocessed.invoices,
            preprocessed.payments
        );
        console.log(
            `[${RUN_ID}] Event KPI log (chronological replay vs expected-results.xlsx)`
        );
        computeCustomerDailyKpiTimeline({
            accountId,
            customerId,
            fromDate: config.fromDate,
            toDate: config.toDate,
            invoices: replayInputs.invoices,
            payments: replayInputs.payments,
            config: { approvedLimit: GOLDEN_APPROVED_LIMIT },
            expectedKpiRows: expectedRows,
            onAfterEvent: logGoldenEventKpiMatrix,
        });
    }

    const timeline = await computeCustomerDailyKpiTimelineFromDb({
        accountId,
        customerId,
        fromDate: config.fromDate,
        toDate: config.toDate,
    });

    const comparison = compareGoldenKpiTimeline(expectedRows, timeline);

    if (!comparison.match) {
        const mismatch = comparison.firstMismatch;
        if (mismatch) {
            failMismatch(
                `${mismatch.date} ${mismatch.column}: expected ${mismatch.expected}, actual ${mismatch.actual}`
            );
        }
        failMismatch("Timeline did not match expected results");
    }

    console.log(
        `[${RUN_ID}] SUCCESS: ${expectedRows.length}/${expectedRows.length} days matched (${config.fromDate} → ${config.toDate})`
    );
    process.exit(0);
}

main().catch((error) => {
    console.error(
        "IMPORT_FAILED:",
        error instanceof Error ? error.message : error
    );
    process.exit(1);
});
