#!/usr/bin/env tsx

/**
 * Cleanup Utility for Stress Tests
 *
 * Deletes only import data created during stress tests using runId prefixes.
 * Keeps accounts, users, and activities for reuse in subsequent tests.
 * Cleans up in reverse dependency order: payments → invoices → contacts → customers → import jobs.
 */

import { prisma } from "@/lib/prisma";
import { ImportJobService } from "@/server/services/ImportJobService";
import { processWithConcurrencyLimit } from "@/utils/concurrencyLimiter";
import * as fs from "fs";
import * as path from "path";

export interface CleanupStats {
    importJobsDeleted: number;
    customersDeleted: number;
    invoicesDeleted: number;
    contactsDeleted: number;
    paymentsDeleted: number;
    filesDeleted: number;
}

/**
 * Delete all test data for a runId
 */
export async function cleanupTestData(
    runId: string,
    maxConcurrency: number = 5
): Promise<CleanupStats> {
    const stats: CleanupStats = {
        importJobsDeleted: 0,
        customersDeleted: 0,
        invoicesDeleted: 0,
        contactsDeleted: 0,
        paymentsDeleted: 0,
        filesDeleted: 0,
    };

    console.log(`[${runId}] Starting cleanup...`);

    try {
        // Step 1: Find all import jobs with runId in metadata
        const importJobs = await prisma.importJob.findMany({
            where: {
                metadata: {
                    path: ["runId"],
                    equals: runId,
                },
            },
            select: { id: true },
        });

        console.log(
            `[${runId}] Found ${importJobs.length} import jobs to delete`
        );

        // Delete import jobs in parallel batches
        if (importJobs.length > 0) {
            await processWithConcurrencyLimit(
                importJobs,
                async (job) => {
                    try {
                        await ImportJobService.deleteImportJob(job.id);
                        stats.importJobsDeleted++;
                    } catch (error: any) {
                        console.error(
                            `[${runId}] Failed to delete import job ${job.id}:`,
                            error.message
                        );
                    }
                },
                maxConcurrency * 2 // Higher concurrency for cleanup
            );
        }

        // Step 2: Delete payments with test prefix
        const paymentPrefix = `STRESS_TEST_PAY_${runId}`;
        const payments = await prisma.invoicePayment.findMany({
            where: {
                reference: {
                    startsWith: paymentPrefix,
                },
            },
            select: { id: true },
        });

        if (payments.length > 0) {
            // Delete in batches for better performance
            const batchSize = 1000;
            for (let i = 0; i < payments.length; i += batchSize) {
                const batch = payments.slice(i, i + batchSize);
                await prisma.invoicePayment.deleteMany({
                    where: {
                        id: {
                            in: batch.map((p) => p.id),
                        },
                    },
                });
            }
            stats.paymentsDeleted = payments.length;
            console.log(`[${runId}] Deleted ${stats.paymentsDeleted} payments`);
        }

        // Step 3: Delete invoices with test prefix
        const invoicePrefix = `STRESS_TEST_INV_${runId}`;
        const invoices = await prisma.invoice.findMany({
            where: {
                invoice_number: {
                    startsWith: invoicePrefix,
                },
            },
            select: { id: true },
        });

        if (invoices.length > 0) {
            // Delete in batches for better performance
            const batchSize = 1000;
            for (let i = 0; i < invoices.length; i += batchSize) {
                const batch = invoices.slice(i, i + batchSize);
                await prisma.invoice.deleteMany({
                    where: {
                        id: {
                            in: batch.map((inv) => inv.id),
                        },
                    },
                });
            }
            stats.invoicesDeleted = invoices.length;
            console.log(`[${runId}] Deleted ${stats.invoicesDeleted} invoices`);
        }

        // Step 4: Delete contacts with test email prefix
        const contactEmailPrefix = `contact`;
        const contactEmailSuffix = `_${runId.substring(0, 8)}@test.local`;
        const contacts = await prisma.contact.findMany({
            where: {
                email: {
                    contains: runId.substring(0, 8),
                },
            },
            select: { id: true },
        });

        if (contacts.length > 0) {
            // Delete in batches for better performance
            const batchSize = 1000;
            for (let i = 0; i < contacts.length; i += batchSize) {
                const batch = contacts.slice(i, i + batchSize);
                await prisma.contact.deleteMany({
                    where: {
                        id: {
                            in: batch.map((c) => c.id),
                        },
                    },
                });
            }
            stats.contactsDeleted = contacts.length;
            console.log(`[${runId}] Deleted ${stats.contactsDeleted} contacts`);
        }

        // Step 5: Delete customers with test prefix
        const customerPrefix = `STRESS_TEST_CUST_${runId}`;
        const customers = await prisma.customer.findMany({
            where: {
                customer_number: {
                    startsWith: customerPrefix,
                },
            },
            select: { id: true },
        });

        if (customers.length > 0) {
            // Delete in batches for better performance
            const batchSize = 500; // Smaller batch for customers due to cascades
            for (let i = 0; i < customers.length; i += batchSize) {
                const batch = customers.slice(i, i + batchSize);
                await prisma.customer.deleteMany({
                    where: {
                        id: {
                            in: batch.map((c) => c.id),
                        },
                    },
                });
            }
            stats.customersDeleted = customers.length;
            console.log(
                `[${runId}] Deleted ${stats.customersDeleted} customers`
            );
        }

        // Step 6: Delete temporary files
        // Note: Accounts, users, and activities are kept for reuse in subsequent tests
        const fileDir = path.join("/tmp", "stress-test-imports", runId);
        try {
            if (fs.existsSync(fileDir)) {
                await fs.promises.rm(fileDir, { recursive: true, force: true });
                stats.filesDeleted = 1;
                console.log(`[${runId}] Deleted temporary files`);
            }
        } catch (error: any) {
            console.warn(
                `[${runId}] Failed to delete temporary files:`,
                error.message
            );
        }

        console.log(`[${runId}] ✅ Cleanup complete!`);
        console.log(`[${runId}] Summary:`, stats);
        console.log(
            `[${runId}] Note: Accounts, users, and activities were kept for reuse in subsequent tests`
        );
    } catch (error: any) {
        console.error(`[${runId}] ❌ Cleanup error:`, error.message);
        throw error;
    }

    return stats;
}

// Allow running as standalone script for testing
if (require.main === module) {
    const runId = process.argv[2];

    if (!runId) {
        console.error("Usage: cleanup-import-data.ts <runId>");
        process.exit(1);
    }

    cleanupTestData(runId)
        .then((stats) => {
            console.log("\n✅ Cleanup completed!");
            console.log("Stats:", stats);
            process.exit(0);
        })
        .catch((error) => {
            console.error("❌ Cleanup failed:", error);
            process.exit(1);
        });
}
