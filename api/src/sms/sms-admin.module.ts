import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { SmsCountryVendorsController } from "./sms-country-vendors.controller";
import { SmsCountryVendorsService } from "./sms-country-vendors.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [SmsCountryVendorsController],
    providers: [SmsCountryVendorsService],
})
export class SmsAdminModule {}
