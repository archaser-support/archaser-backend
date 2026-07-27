import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { InvoicePaymentDateController } from "./invoice-payment-date.controller";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [InvoicesController, InvoicePaymentDateController],
    providers: [InvoicesService],
    exports: [InvoicesService],
})
export class InvoicesModule {}
