import {
    BadRequestException,
    Body,
    Controller,
    NotFoundException,
    Post,
    UnprocessableEntityException,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AccessScopeService } from "../auth/access-scope.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

@ApiTags("invoices")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/invoices")
export class InvoicePaymentDateController {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    @Post("update-last-payment-date")
    @ApiOperation({
        summary: "Update invoice last payment date (Nest-native)",
    })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async updateLastPaymentDate(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const actor = this.accessScope.getEffectiveUserId(userInfo);

        const invoiceId =
            typeof body.invoiceId === "number"
                ? body.invoiceId
                : typeof body.invoiceId === "string"
                  ? Number.parseInt(body.invoiceId, 10)
                  : NaN;
        if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
            throw new BadRequestException({ error: "Invalid invoiceId" });
        }

        const lastPaymentDate = body.lastPaymentDate;
        if (
            typeof lastPaymentDate !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(lastPaymentDate.trim())
        ) {
            throw new BadRequestException({
                error: "lastPaymentDate must be a valid YYYY-MM-DD date",
            });
        }

        const invoice = await this.db.invoice.findUnique({
            where: { id: invoiceId },
            select: { id: true, customer_id: true, account_id: true },
        });
        if (!invoice) {
            throw new NotFoundException({ error: "Invoice not found" });
        }
        if (!invoice.customer_id) {
            throw new UnprocessableEntityException({
                error: "Invoice is not linked to a customer",
            });
        }
        if (
            invoice.account_id !== accountId &&
            userInfo.accountId !== 10013
        ) {
            throw new BadRequestException({ error: "Access denied" });
        }

        const paymentDate = new Date(`${lastPaymentDate.trim()}T00:00:00.000Z`);
        const updated = await this.db.invoice.update({
            where: { id: invoiceId },
            data: {
                last_payment_date: paymentDate,
                modified_by: actor,
                modified_at: new Date(),
            },
            select: {
                id: true,
                last_payment_date: true,
                customer_id: true,
            },
        });

        return serializeBigInt({
            success: true,
            invoice: updated,
        });
    }
}
