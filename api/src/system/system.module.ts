import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { QueueModule } from "../queue/queue.module";
import {
    SystemCacheInvalidationController,
    SystemController,
} from "./system.controller";
import { SystemService } from "./system.service";

@Module({
    imports: [AuthModule, DatabaseModule, InvoicesModule, QueueModule],
    controllers: [
        SystemController,
        SystemCacheInvalidationController,
    ],
    providers: [SystemService],
    exports: [SystemService],
})
export class SystemModule {}
