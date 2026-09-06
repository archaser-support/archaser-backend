import { Controller, Param, ParseIntPipe, Post, Req, UseGuards } from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { DualAuthGuard, DualAuthRequest } from "../auth/dual-auth.guard";
import { CronQueueService } from "./cron-queue.service";

@ApiTags("cron-queue")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/gateway/cron")
export class CronQueueController {
    constructor(private readonly cronQueue: CronQueueService) {}

    @Post("sync-schedules")
    @ApiOperation({
        summary: "Ask worker to resync BullMQ repeatables from CronJob config",
    })
    async syncSchedules(@Req() req: DualAuthRequest) {
        const result = await this.cronQueue.enqueueSyncSchedules({
            reason: "manual",
        });
        return { triggeredBy: req.user?.sub, ...result };
    }

    @Post(":jobId/run-now")
    @ApiOperation({
        summary: "Enqueue CronJob run-now on BullMQ (worker executes)",
    })
    @ApiUnauthorizedResponse({ description: "Missing auth" })
    async runNow(
        @Param("jobId", ParseIntPipe) jobId: number,
        @Req() req: DualAuthRequest
    ) {
        const result = await this.cronQueue.enqueueRunNow({
            cronJobId: jobId,
            triggeredBy: req.user?.sub,
            accountId: req.user?.account_id ?? null,
        });
        return {
            cronJobId: jobId,
            ...result,
        };
    }
}
