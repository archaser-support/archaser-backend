import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { InvoicePaymentDateController } from "./invoice-payment-date.controller";
import { InvoiceMepIgnoredController } from "./invoice-mep-ignored.controller";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [
        InvoicesController,
        InvoicePaymentDateController,
        InvoiceMepIgnoredController,
    ],
    providers: [InvoicesService],
    exports: [InvoicesService],
})
export class InvoicesModule {}
