#!/usr/bin/env tsx

/**
 * Import Job Runner for Stress Tests
 *
 * Executes import jobs via API endpoints with retry/backoff.
 * Handles all import types: Customer, Invoice, Contact, Payment.
 */

import * as fs from "fs";
import Papa from "papaparse";
import { ImportType } from "@prisma/client";
import { AxiosInstance } from "axios";
import { ImportFileDescriptor } from "./generate-import-files";
import { AuthSession } from "./auth-helper";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const BATCH_SIZE = 50; // Process records in batches

export interface ImportJobResult {
    jobId: string;
    type: ImportType;
    recordCount: number;
    success: boolean;
    error?: string;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = MAX_RETRIES,
    baseDelay: number = RETRY_DELAY_MS
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            if (attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, attempt);
                await sleep(delay);
            }
        }
    }

    throw lastError || new Error("Retry failed");
}

/**
 * Parse CSV file
 */
async function parseCSVFile(filePath: string): Promise<Record<string, any>[]> {
    const fileContent = await fs.promises.readFile(filePath, "utf-8");
    return new Promise((resolve, reject) => {
        Papa.parse<Record<string, any>>(fileContent, {
            header: true,
            skipEmptyLines: true,
            complete: (result) => {
                resolve(result.data);
            },
            error: (error: any) => reject(error),
        });
    });
}

/**
 * Map import type to API endpoint
 */
function getImportEndpoint(type: ImportType): string {
    switch (type) {
        case ImportType.Customer:
            return "/api/import/customer";
        case ImportType.Invoice:
            return "/api/import/invoice";
        case ImportType.Contact:
            return "/api/import/contact";
        case ImportType.Payment:
            return "/api/import/payment";
        default:
            throw new Error(`Unsupported import type: ${type}`);
    }
}

/**
 * Map file type to ImportType enum
 */
function getImportTypeFromFileType(
    type: ImportFileDescriptor["type"]
): ImportType {
    switch (type) {
        case "customer":
            return ImportType.Customer;
        case "invoice":
            return ImportType.Invoice;
        case "contact":
            return ImportType.Contact;
        case "payment":
            return ImportType.Payment;
        default:
            throw new Error(`Unsupported file type: ${type}`);
    }
}

/**
 * Create import job
 */
async function createImportJob(
    client: AxiosInstance,
    importType: ImportType,
    totalRecords: number,
    metadata: any = {}
): Promise<string> {
    const response = await client.post("/api/import/job/create", {
        import_type: importType,
        total_records: totalRecords,
        metadata,
    });

    if (response.status !== 201 || !response.data?.jobId) {
        throw new Error(
            `Failed to create import job: ${response.status} ${JSON.stringify(response.data)}`
        );
    }

    return response.data.jobId;
}

/**
 * Upload import data in batches
 */
async function uploadImportData(
    client: AxiosInstance,
    endpoint: string,
    jobId: string,
    records: Record<string, any>[],
    runId: string,
    userId: string
): Promise<void> {
    // Process in batches
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE);

        await retryWithBackoff(async () => {
            const payload: any = {
                jobId,
                batchIndex,
                globalStartIndex: i,
            };

            // Map payload field name based on import type
            if (endpoint.includes("customer")) {
                payload.customers = batch;
            } else if (endpoint.includes("invoice")) {
                payload.invoices = batch;
            } else if (endpoint.includes("contact")) {
                payload.contacts = batch;
            } else if (endpoint.includes("payment")) {
                payload.payments = batch;
            }

            const response = await client.post(endpoint, payload);

            if (response.status !== 200 && response.status !== 201) {
                throw new Error(
                    `Import batch failed: ${response.status} ${JSON.stringify(response.data)}`
                );
            }

            // Log response details to track actual record creation
            const responseData = response.data || {};
            const results = responseData.results || [];
            const successCount = results.filter(
                (r: any) => r.success !== false
            ).length;
            const failureCount = results.filter(
                (r: any) => r.success === false
            ).length;

            console.log(
                `[${runId}][${userId}] Uploaded batch ${batchIndex + 1} (${batch.length} records) - ` +
                    `Success: ${successCount}, Failed: ${failureCount}`
            );

            if (failureCount > 0) {
                const errors = results
                    .filter((r: any) => r.success === false)
                    .map((r: any) => r.error || r.message)
                    .slice(0, 3); // Show first 3 errors
                console.warn(
                    `[${runId}][${userId}] Batch ${batchIndex + 1} had ${failureCount} failures: ${errors.join("; ")}`
                );
            }
        });
    }
}

/**
 * Run import job for a single file
 */
export async function runImportJob(
    session: AuthSession,
    fileDescriptor: ImportFileDescriptor,
    runId: string,
    cycleNumber?: number
): Promise<ImportJobResult> {
    const importType = getImportTypeFromFileType(fileDescriptor.type);
    const endpoint = getImportEndpoint(importType);

    try {
        // Parse CSV file
        let records = await parseCSVFile(fileDescriptor.filePath);

        // For payment imports, make references unique per cycle to avoid unique constraint violations
        if (fileDescriptor.type === "payment" && cycleNumber !== undefined) {
            records = records.map((record) => ({
                ...record,
                reference: record.reference
                    ? `${record.reference}_cycle${cycleNumber}`
                    : undefined,
            }));
        }

        // Create import job
        const jobId = await retryWithBackoff(() =>
            createImportJob(session.client, importType, records.length, {
                runId,
                filePath: fileDescriptor.filePath,
            })
        );

        // Upload data in batches
        await uploadImportData(
            session.client,
            endpoint,
            jobId,
            records,
            runId,
            session.userId
        );

        return {
            jobId,
            type: importType,
            recordCount: records.length,
            success: true,
        };
    } catch (error: any) {
        return {
            jobId: "",
            type: importType,
            recordCount: fileDescriptor.recordCount,
            success: false,
            error: error.message || String(error),
        };
    }
}

/**
 * Run all import jobs for a user
 */
export async function runAllImportJobs(
    session: AuthSession,
    fileDescriptors: ImportFileDescriptor[],
    runId: string,
    cycleNumber?: number
): Promise<ImportJobResult[]> {
    console.log(
        `[${runId}][${session.userId}] runAllImportJobs: Starting ${fileDescriptors.length} import jobs...`
    );
    const allJobsStartTime = Date.now();
    const results: ImportJobResult[] = [];

    // Run imports sequentially to avoid overwhelming the system
    for (let i = 0; i < fileDescriptors.length; i++) {
        const fileDescriptor = fileDescriptors[i];
        console.log(
            `[${runId}][${session.userId}] runAllImportJobs: [${i + 1}/${fileDescriptors.length}] Starting ${fileDescriptor.type} import (${fileDescriptor.recordCount} records)...`
        );
        const jobStartTime = Date.now();

        const result = await runImportJob(
            session,
            fileDescriptor,
            runId,
            cycleNumber
        );
        const jobDuration = Date.now() - jobStartTime;
        results.push(result);

        if (result.success) {
            console.log(
                `[${runId}][${session.userId}] runAllImportJobs: ✅ [${i + 1}/${fileDescriptors.length}] ${fileDescriptor.type} import completed in ${jobDuration}ms (Job: ${result.jobId})`
            );
        } else {
            console.error(
                `[${runId}][${session.userId}] runAllImportJobs: ❌ [${i + 1}/${fileDescriptors.length}] ${fileDescriptor.type} import failed in ${jobDuration}ms: ${result.error}`
            );
        }

        // Small delay between imports
        if (i < fileDescriptors.length - 1) {
            console.log(
                `[${runId}][${session.userId}] runAllImportJobs: Waiting 500ms before next import...`
            );
            await sleep(500);
        }
    }

    const allJobsDuration = Date.now() - allJobsStartTime;
    const successCount = results.filter((r) => r.success).length;
    console.log(
        `[${runId}][${session.userId}] runAllImportJobs: ✅ Completed ${successCount}/${fileDescriptors.length} imports in ${allJobsDuration}ms`
    );

    return results;
}
