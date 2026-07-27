import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import {
    SmsController,
    SmsCountryVendorsController,
    SmsVendorsController,
    SmsWebhookController,
} from "./sms.controllers";
import { SmsService } from "./sms.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [
        SmsController,
        SmsVendorsController,
        SmsCountryVendorsController,
        SmsWebhookController,
    ],
    providers: [SmsService],
    exports: [SmsService],
})
export class SmsModule {}
