import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import {
    ACCOUNT_ADMIN_ENTITY_TYPES,
    AccountAdminEntitiesService,
} from "./account-admin-entities.service";
import { BankAccountsLeafController } from "./bank-accounts-leaf.controller";
import { createAccountAdminController } from "./create-account-admin.controller";

const controllers = [
    ...ACCOUNT_ADMIN_ENTITY_TYPES.map((t) => createAccountAdminController(t)),
    BankAccountsLeafController,
];

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers,
    providers: [AccountAdminEntitiesService],
    exports: [AccountAdminEntitiesService],
})
export class AccountAdminEntitiesModule {}
