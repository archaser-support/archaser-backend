import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { SettingsController } from "./settings.controller";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [SettingsController],
})
export class SettingsModule {}
