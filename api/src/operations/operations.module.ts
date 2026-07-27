import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { OperationsDomainController } from "./operations.controller";
import { OperationsService } from "./operations.service";

@Module({
    imports: [AuthModule, DatabaseModule, RealtimeModule],
    controllers: [OperationsDomainController],
    providers: [OperationsService],
    exports: [OperationsService],
})
export class OperationsModule {}
