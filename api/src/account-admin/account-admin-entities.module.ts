import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EmailModule } from "../email/email.module";
import {
    ACCOUNT_ADMIN_ENTITY_TYPES,
    AccountAdminEntitiesService,
} from "./account-admin-entities.service";
import { AccountsBankAccountsController } from "./accounts-bank-accounts.controller";
import { AccountsBusinessUnitsController } from "./accounts-business-units.controller";
import { BankAccountsLeafController } from "./bank-accounts-leaf.controller";
import { BusinessUnitBanksController } from "./business-unit-banks.controller";
import { createAccountAdminController } from "./create-account-admin.controller";
import {
    AccountsExtrasController,
    UsersExtrasController,
} from "./users-accounts-extras.controller";

const controllers = [
    ...ACCOUNT_ADMIN_ENTITY_TYPES.map((t) => createAccountAdminController(t)),
    BusinessUnitBanksController,
    AccountsBusinessUnitsController,
    AccountsBankAccountsController,
    BankAccountsLeafController,
    UsersExtrasController,
    AccountsExtrasController,
];

@Module({
    imports: [AuthModule, DatabaseModule, EmailModule],
    controllers,
    providers: [AccountAdminEntitiesService],
    exports: [AccountAdminEntitiesService],
})
export class AccountAdminEntitiesModule {}
