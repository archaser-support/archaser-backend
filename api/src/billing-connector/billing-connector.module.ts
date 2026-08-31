import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { MetricsModule } from "../metrics/metrics.module";
import { BillingConnectorController } from "./billing-connector.controller";
import { BillingConnectorApiService } from "./billing-connector.service";

@Module({
    imports: [AuthModule, DatabaseModule, MetricsModule],
    controllers: [BillingConnectorController],
    providers: [BillingConnectorApiService],
    exports: [BillingConnectorApiService],
})
export class BillingConnectorModule {}
