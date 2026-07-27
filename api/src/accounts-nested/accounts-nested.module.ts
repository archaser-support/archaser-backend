import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import {
    AccountsController,
    BillingConnectorController,
    CheckUsernameController,
    NotificationRuleSetsController,
} from "./accounts-nested.controllers";
import { AccountsNestedService } from "./accounts-nested.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [
        AccountsController,
        CheckUsernameController,
        BillingConnectorController,
        NotificationRuleSetsController,
    ],
    providers: [AccountsNestedService],
    exports: [AccountsNestedService],
})
export class AccountsNestedModule {}
