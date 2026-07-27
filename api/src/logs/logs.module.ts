import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { LogsController } from "./logs.controller";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [LogsController],
})
export class LogsModule {}
