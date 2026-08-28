import { randomUUID } from "crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { importMappedEntityBatch } from "@archaser/billing-connector";
import { DatabaseService } from "../database/database.service";
import { runArPostIngestForCustomers } from "../credit-insurance/domain/arPostIngestOrchestrator";
import { enqueueRewriteForImport } from "../credit-insurance/domain/asOfRewriteQueue";
import { refreshInsuranceTargetDatesForInvoiceIds } from "../credit-insurance/domain/syncInvoiceReportingBreach";
import { recalculateCustomerAmounts } from "../customers/domain/recalculateCustomerAmounts";
import { ImportPolicyService } from "./import-policy.service";

const IMPORT_TYPE_MAP: Record<string, string> = {
    payment: "Payment",
    customer: "Customer",
    contact: "Contact",
    invoice: "Invoice",
    policy: "Policy",
};

const LEAF_BODY_KEYS: Record<string, string> = {
    payment: "payments",
    customer: "customers",
    contact: "contacts",
    invoice: "invoices",
    policy: "policies",
};

@Injectable()
export class ImportService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService,
        private readonly importPolicy: ImportPolicyService
    ) {}

    /**
     * Process a batch of import rows for a leaf type.
     * Creates/updates ImportRecord rows for the job and returns per-row results.
     * Full entity upsert (ImportCustomerService etc.) remains a follow-up; this
     * removes the empty `{results:[]}` fake-success stub (P0 S5).
     */
    async importLeaf(
        leaf: string,
        user: JwtPayload,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const importType = IMPORT_TYPE_MAP[leaf];
        if (!importType) {
            throw new NotFoundException({
                error: `Unknown import leaf: ${leaf}`,
            });
        }

        const jobId = String(body.jobId || body.id || "");
        if (!jobId) {
            throw new NotFoundException({ error: "jobId is required" });
        }

        const job = await this.db.importJob.findFirst({
            where: { id: jobId, account_id: accountId },
            select: { id: true, import_type: true, status: true, metadata: true },
        });
        if (!job) {
            throw new NotFoundException({ error: "Import job not found" });
        }

        const key = LEAF_BODY_KEYS[leaf];
        const rows = Array.isArray(body[key])
            ? (body[key] as Array<Record<string, unknown>>)
            : Array.isArray(body.rows)
              ? (body.rows as Array<Record<string, unknown>>)
              : Array.isArray(body.records)
                ? (body.records as Array<Record<string, unknown>>)
                : [];

        const batchIndex = Number(body.batchIndex ?? 0);
        const globalStartIndex = Number(body.globalStartIndex ?? 0);
        const results: Array<Record<string, unknown>> = [];
        const affectedCustomerIds = new Set<number>();
        const importedEntityIds = new Set<number>();
        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;

        if (leaf === "policy") {
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i] || {};
                const rowIndex = globalStartIndex + i;
                const policyResult = await this.importPolicy.importPolicyRow(row, {
                    accountId,
                    userId: this.accessScope.getEffectiveUserId(userInfo),
                    businessUnitId: userInfo.businessUnitId ?? null,
                    role: userInfo.viewAsUserRole || userInfo.role,
                });
                if (policyResult.success) {
                    successCount += 1;
                    try {
                        await this.db.importRecord.create({
                            data: {
                                id: `${jobId}-${rowIndex}-${Date.now()}-${i}`,
                                import_job_id: jobId,
                                row_index: rowIndex,
                                status: "Success",
                                original_data: row as never,
                                processed_data: row as never,
                                result_message: policyResult.action,
                                created_by: userInfo.userId,
                                modified_by: userInfo.userId,
                            } as never,
                        });
                    } catch {
                        // Import rows must continue when audit record persistence fails.
                    }
                    results.push({
                        index: rowIndex,
                        batchIndex,
                        success: true,
                        skipped: false,
                        message: policyResult.action,
                        action: policyResult.action,
                        customerId: policyResult.customerId,
                    });
                } else {
                    failCount += 1;
                    const error = `${policyResult.errorCode}:${policyResult.message}`;
                    try {
                        await this.db.importRecord.create({
                            data: {
                                id: `${jobId}-${rowIndex}-${Date.now()}-${i}`,
                                import_job_id: jobId,
                                row_index: rowIndex,
                                status: "Failed",
                                original_data: row as never,
                                processed_data: row as never,
                                result_message: policyResult.message,
                                processing_errors: {
                                    code: policyResult.errorCode,
                                    message: policyResult.message,
                                } as never,
                                created_by: userInfo.userId,
                                modified_by: userInfo.userId,
                            } as never,
                        });
                    } catch {
                        // Import rows must continue when audit record persistence fails.
                    }
                    results.push({
                        index: rowIndex,
                        batchIndex,
                        success: false,
                        skipped: false,
                        error,
                        errorCode: policyResult.errorCode,
                        message: policyResult.message,
                    });
                }
            }
        } else {
            const entityImport = await importMappedEntityBatch(
                this.db,
                importType as "Customer" | "Contact" | "Invoice" | "Payment",
                rows,
                accountId,
                null,
                userInfo.userId
            );
            // Amount (and date) upserts must refresh insurance targets immediately
            // so sign flips are not stuck until job-complete post-ingest.
            if (
                importType === "Invoice" &&
                entityImport.entityIds.length > 0
            ) {
                try {
                    await refreshInsuranceTargetDatesForInvoiceIds(
                        entityImport.entityIds,
                        this.db
                    );
                } catch {
                    // Non-fatal: rows imported; post-ingest / stamp can catch up.
                }
            }
            const recordRows: Array<Record<string, unknown>> = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i] || {};
                const rowIndex = globalStartIndex + i;
                const rowResult = entityImport.rowResults?.[i];
                const success = Boolean(rowResult?.success);
                const skipped = Boolean(rowResult?.skipped);
                const error = rowResult?.error;
                if (success && !skipped) successCount += 1;
                else if (skipped) skipCount += 1;
                else failCount += 1;
                if (rowResult?.customerId != null) {
                    affectedCustomerIds.add(rowResult.customerId);
                }
                if (rowResult?.entityId != null) {
                    importedEntityIds.add(rowResult.entityId);
                }
                recordRows.push({
                    id: `${jobId}-${rowIndex}-${Date.now()}-${i}`,
                    import_job_id: jobId,
                    row_index: rowIndex,
                    status: success ? "Success" : skipped ? "Skipped" : "Failed",
                    original_data: row,
                    processed_data: row,
                    result_message: error || null,
                    processing_errors: error ? { message: error } : undefined,
                    entity_id: rowResult?.entityId ?? null,
                    created_by: userInfo.userId,
                    modified_by: userInfo.userId,
                });
                results.push({
                    index: rowIndex,
                    batchIndex,
                    success,
                    skipped,
                    error,
                });
            }
            if (recordRows.length > 0) {
                try {
                    await this.db.importRecord.createMany({
                        data: recordRows as never,
                    });
                } catch {
                    // Import rows must continue when audit record persistence fails.
                }
            }
            for (const id of entityImport.affectedCustomerIds) {
                affectedCustomerIds.add(id);
            }
            for (const id of entityImport.entityIds) {
                importedEntityIds.add(id);
            }
        }

        await this.db.importJob.update({
            where: { id: jobId },
            data: {
                status: "InProgress",
                successful_records: { increment: successCount },
                failed_records: { increment: failCount },
                metadata: {
                    ...asObject(job.metadata),
                    asOfRewriteCustomerIds: [...affectedCustomerIds],
                    asOfRewriteEntityIds: [
                        ...readNumberArray(job.metadata, "asOfRewriteEntityIds"),
                        ...importedEntityIds,
                    ],
                } as never,
                modified_at: new Date(),
            } as never,
        });

        return serializeBigInt({
            results,
            message: "ok",
            jobId,
            importType,
            affectedCustomerIds: [...affectedCustomerIds],
            processed: rows.length,
            successful: successCount,
            failed: failCount,
            skipped: skipCount,
        });
    }

    async createJob(user: JwtPayload, body: Record<string, unknown>) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveUserId = this.accessScope.getEffectiveUserId(userInfo);

        const rawType = String(body.import_type || body.type || "Customer");
        const importType =
            IMPORT_TYPE_MAP[rawType.toLowerCase()] || "Customer";

        const job = await this.db.importJob.create({
            data: {
                id: randomUUID(),
                account_id: accountId,
                user_id: effectiveUserId,
                import_type: importType,
                status: "Pending",
                total_records: Number(body.total_records) || 0,
                metadata: body.metadata ?? undefined,
            } as never,
        });

        return serializeBigInt({ ...job, jobId: job.id });
    }

    async completeJob(user: JwtPayload, body: Record<string, unknown>) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const jobId = String(body.jobId || body.id || "");
        const existing = await this.db.importJob.findFirst({
            where: { id: jobId, account_id: accountId },
            select: { id: true, import_type: true, metadata: true },
        });
        if (!existing) {
            throw new NotFoundException({ error: "Import job not found" });
        }

        const job = await this.db.importJob.update({
            where: { id: jobId },
            data: {
                status: "Completed",
                completed_at: new Date(),
                ...(body.successful_records !== undefined
                    ? { successful_records: Number(body.successful_records) }
                    : {}),
                ...(body.failed_records !== undefined
                    ? { failed_records: Number(body.failed_records) }
                    : {}),
            },
        });
        if (
            existing.import_type === "Invoice" ||
            existing.import_type === "Payment"
        ) {
            const importType = existing.import_type as "Invoice" | "Payment";
            const customerIds = readNumberArray(
                existing.metadata,
                "asOfRewriteCustomerIds"
            );
            const entityIds = readNumberArray(
                existing.metadata,
                "asOfRewriteEntityIds"
            );

            // Shared AR post-ingest (replay + Process Overdue + live MEP/gap + as-of).
            // Best-effort: do not fail job status if this throws after rows were imported.
            let postIngestSkipped = false;
            try {
                const result = await runArPostIngestForCustomers({
                    accountId,
                    customerIds,
                    runReplay: true,
                    runLiveRefresh: true,
                    enqueueAsOfRewrite: true,
                    asOfRewrite: { importType, entityIds },
                });
                postIngestSkipped = result.skipped;
            } catch {
                postIngestSkipped = true;
            }

            // Collection-only (orchestrator CI gate) and unexpected throws still
            // keep today's as-of enqueue behavior. Overdue already ran inside
            // the orchestrator for non-CI accounts before skipped=true.
            if (postIngestSkipped) {
                try {
                    await enqueueRewriteForImport({
                        accountId,
                        importType,
                        entityIds,
                        customerIds,
                    });
                } catch {
                    // Import completion should not fail if as-of enqueue fails.
                }
            }

            if (customerIds.length > 0) {
                try {
                    await recalculateCustomerAmounts(customerIds, this.db);
                } catch {
                    // Import completion should not fail if rollup refresh fails.
                }
            }
        }

        return serializeBigInt(job);
    }

    async getJobById(user: JwtPayload, jobId: string) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const job = await this.db.importJob.findFirst({
            where: { id: jobId, account_id: accountId },
            include: { ImportRecord: true },
        });
        if (!job) {
            throw new NotFoundException({ error: "Import job not found" });
        }

        const { ImportRecord: importRecords = [], ...jobFields } = job;
        const records = importRecords.map((record) => ({
            ...record,
            original_data: record.original_data,
        }));
        const successful = records.filter(
            (record) =>
                record.status === "Success" || record.status === "Validated"
        ).length;
        const failed = records.filter(
            (record) => record.status === "Failed"
        ).length;

        return serializeBigInt({
            ...jobFields,
            jobId: job.id,
            records,
            results: records.map((record) => ({
                index: record.row_index,
                success:
                    record.status === "Success" ||
                    record.status === "Validated",
                skipped: record.status === "Skipped",
                message: record.result_message || "",
                originalData: record.original_data || {},
                customerId: record.entity_id,
            })),
            statistics: {
                total: records.length || job.total_records,
                successful: job.successful_records || successful,
                failed: job.failed_records || failed,
            },
            metadata: job.metadata,
        });
    }
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function readNumberArray(value: unknown, key: string): number[] {
    const candidate = asObject(value)[key];
    return Array.isArray(candidate)
        ? candidate.filter((item): item is number => Number.isFinite(item))
        : [];
}
