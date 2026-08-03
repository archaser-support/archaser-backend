import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import {
    AccountsController,
    BillingConnectorController,
    NotificationRuleSetsController,
} from "./accounts-nested.controllers";
import { AccountsNestedService } from "./accounts-nested.service";

/**
 * Public accounts + billing-connector routes for connectors peel (D28/D66).
 * CheckUsername stays on main API.
 */
@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [
        AccountsController,
        BillingConnectorController,
        NotificationRuleSetsController,
    ],
    providers: [AccountsNestedService],
    exports: [AccountsNestedService],
})
export class AccountsDomainModule {}
