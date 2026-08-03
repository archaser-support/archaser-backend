import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { SyncQueueService } from "./sync-queue.service";

@Module({
    imports: [DatabaseModule],
    providers: [SyncQueueService],
    exports: [SyncQueueService],
})
export class SyncModule {}
