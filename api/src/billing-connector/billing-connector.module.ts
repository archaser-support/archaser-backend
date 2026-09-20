import { Module, type OnModuleInit } from "@nestjs/common";
import { registerCustomerBalancesFinal } from "@archaser/billing-connector";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { MetricsModule } from "../metrics/metrics.module";
import { QueueModule } from "../queue/queue.module";
import { BillingConnectorController } from "./billing-connector.controller";
import { BillingConnectorApiService } from "./billing-connector.service";
import { recalculateCustomerAmounts } from "../customers/domain/recalculateCustomerAmounts";

@Module({
    imports: [AuthModule, DatabaseModule, MetricsModule, QueueModule],
    controllers: [BillingConnectorController],
    providers: [BillingConnectorApiService],
    exports: [BillingConnectorApiService],
})
export class BillingConnectorModule implements OnModuleInit {
    /**
     * Prefer a normal api import for customer rollups when sync falls back to
     * recalculateCustomerAmountsViaHost (no onCustomerBalancesFinal on options).
     * Deploy still requires api/dist/customers for worker/connectors hosts.
     */
    onModuleInit(): void {
        registerCustomerBalancesFinal(async (customerIds, prisma, options) => {
            await recalculateCustomerAmounts(customerIds, prisma, options);
        });
    }
}
