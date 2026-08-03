import { randomUUID } from "crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { importMappedEntityBatch } from "@archaser/billing-connector";
import { DatabaseService } from "../database/database.service";

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
        private readonly accessScope: AccessScopeService
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
            select: { id: true, import_type: true, status: true },
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
        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i] || {};
            const rowIndex = globalStartIndex + i;
            const entityImport = await importMappedEntityBatch(
                this.db,
                importType as "Customer" | "Contact" | "Invoice" | "Payment",
                [row],
                accountId,
                null,
                userInfo.userId
            );
            for (const id of entityImport.affectedCustomerIds) {
                affectedCustomerIds.add(id);
            }
            const success = entityImport.success > 0;
            const skipped = entityImport.skipped > 0 && entityImport.success === 0;
            const error = entityImport.errors[0];
            if (success) successCount += 1;
            else if (skipped) skipCount += 1;
            else failCount += 1;

            try {
                await this.db.importRecord.create({
                    data: {
                        id: `${jobId}-${rowIndex}-${Date.now()}-${i}`,
                        import_job_id: jobId,
                        row_index: rowIndex,
                        status: success ? "Success" : skipped ? "Skipped" : "Failed",
                        original_data: row as never,
                        processed_data: row as never,
                        result_message: error || null,
                        processing_errors: error
                            ? ({ message: error } as never)
                            : undefined,
                        created_by: userInfo.userId,
                        modified_by: userInfo.userId,
                    } as never,
                });
            } catch {
                // continue
            }
            results.push({
                index: rowIndex,
                batchIndex,
                success,
                skipped,
                error,
            });
        }

        await this.db.importJob.update({
            where: { id: jobId },
            data: {
                status: "InProgress",
                successful_records: { increment: successCount },
                failed_records: { increment: failCount },
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

        return serializeBigInt(job);
    }

    async completeJob(user: JwtPayload, body: Record<string, unknown>) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const jobId = String(body.jobId || body.id || "");
        const existing = await this.db.importJob.findFirst({
            where: { id: jobId, account_id: accountId },
            select: { id: true },
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

        return serializeBigInt(job);
    }
}
