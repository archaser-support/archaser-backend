import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { QueueModule } from "../queue/queue.module";
import {
    SystemCacheInvalidationController,
    SystemController,
    SystemCronLambdaController,
} from "./system.controller";
import { SystemService } from "./system.service";

@Module({
    imports: [AuthModule, DatabaseModule, QueueModule],
    controllers: [
        SystemController,
        SystemCronLambdaController,
        SystemCacheInvalidationController,
    ],
    providers: [SystemService],
    exports: [SystemService],
})
export class SystemModule {}
