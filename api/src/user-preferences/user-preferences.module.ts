import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { UserPreferencesController } from "./user-preferences.controller";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [UserPreferencesController],
})
export class UserPreferencesModule {}
