import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { InternalReportsController } from "../internal/internal-reports.controller";
import { ReportExecutionService } from "./report-execution.service";
import {
    ReportsByIdController,
    ReportsController,
} from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [
        ReportsController,
        ReportsByIdController,
        InternalReportsController,
    ],
    providers: [ReportsService, ReportExecutionService],
    exports: [ReportsService, ReportExecutionService],
})
export class ReportsModule {}
