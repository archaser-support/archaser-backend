import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { AccountsSmsPreferencesController } from "./accounts-sms-preferences.controller";
import { AccountsSmsPreferencesService } from "./accounts-sms-preferences.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [AccountsSmsPreferencesController],
    providers: [AccountsSmsPreferencesService],
})
export class AccountsSmsModule {}
