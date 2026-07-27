import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CronQueueService } from "./cron-queue.service";
import { CronQueueController } from "./cron-queue.controller";

@Module({
    imports: [AuthModule],
    controllers: [CronQueueController],
    providers: [CronQueueService],
    exports: [CronQueueService],
})
export class QueueModule {}
