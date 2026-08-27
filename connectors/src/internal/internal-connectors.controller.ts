import { Body, Controller, Logger, Param, ParseIntPipe, Post, UseGuards } from "@nestjs/common";
import { InternalSecretGuard } from "../auth/internal-secret.guard";
import { SyncQueueService } from "../sync/sync-queue.service";
import { runInProcessSync } from "@archaser/billing-connector";
import { DatabaseService } from "../database/database.service";

@Controller("internal")
@UseGuards(InternalSecretGuard)
export class InternalConnectorsController {
    private readonly logger = new Logger(InternalConnectorsController.name);

    constructor(
        private readonly syncQueue: SyncQueueService,
        private readonly db: DatabaseService
    ) {}

    @Post("accounts/:accountId/sync")
    async sync(
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>
    ) {
        const mode = String(body?.mode || "queue");
        if (mode === "inline") {
            const result = await runInProcessSync({
                prisma: this.db,
                accountId,
                trigger: String(body?.trigger || "internal-inline"),
                onLog: (message) =>
                    this.logger.log(`[account ${accountId}] ${message}`),
            });
            return result;
        }
        return this.syncQueue.enqueue(
            accountId,
            String(body?.trigger || "internal")
        );
    }
}
