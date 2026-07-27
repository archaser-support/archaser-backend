import { randomUUID } from "crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

const IMPORT_TYPE_MAP: Record<string, string> = {
    payment: "Payment",
    customer: "Customer",
    contact: "Contact",
    invoice: "Invoice",
    policy: "Policy",
};

@Injectable()
export class ImportService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    /**
     * Pragmatic Nest-native stub for the dedicated import leaves (payment,
     * customer, contact, invoice, policy). Row-level import processing stays
     * out of scope; callers get a stable `{ results, message }` shape.
     */
    async importLeaf(
        leaf: string,
        user: JwtPayload,
        body: Record<string, unknown>
    ) {
        void user;
        void body;
        void leaf;
        return { results: [], message: "ok" };
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
