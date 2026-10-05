import {
    BadRequestException,
    Body,
    Controller,
    ForbiddenException,
    Get,
    NotFoundException,
    Post,
    Query,
    UnprocessableEntityException,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
    enqueueRewriteForImport,
    isNegativeInvoiceAmount,
    resolveCreditPoolMemberIds,
    syncCustomerInsuranceFields,
} from "@archaser/credit-insurance-domain";
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
export class InvoiceMepIgnoredController {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    @Get("mep-ignored")
    @ApiOperation({
        summary: "List invoice ids ignored for MEP on a customer",
    })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async listMepIgnored(
        @CurrentUser() user: JwtPayload,
        @Query("customerId") customerIdRaw: string
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const customerId = Number.parseInt(customerIdRaw, 10);
        if (!Number.isFinite(customerId) || customerId <= 0) {
            throw new BadRequestException({ error: "Invalid customerId" });
        }

        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: { id: true },
        });
        if (!customer) {
            throw new NotFoundException({ error: "Customer not found" });
        }

        const rows = await this.db.invoice.findMany({
            where: {
                customer_id: customerId,
                account_id: accountId,
                mep_ignored: true,
            },
            select: { id: true },
        });
        return serializeBigInt({
            invoiceIds: rows.map((row) => row.id),
        });
    }

    @Post("mep-ignored")
    @ApiOperation({
        summary: "Toggle invoice ignored for MEP overdue_block",
    })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async updateMepIgnored(
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
        if (typeof body.mepIgnored !== "boolean") {
            throw new BadRequestException({
                error: "mepIgnored must be a boolean",
            });
        }
        const mepIgnored = body.mepIgnored;

        const invoice = await this.db.invoice.findUnique({
            where: { id: invoiceId },
            select: {
                id: true,
                customer_id: true,
                account_id: true,
                status: true,
                amount: true,
            },
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

        const account = await this.db.account.findUnique({
            where: { id: invoice.account_id },
            select: { has_credit_insurance: true },
        });
        if (account?.has_credit_insurance !== true) {
            throw new ForbiddenException({
                error: "Credit insurance is required",
            });
        }

        if (invoice.status !== "Due" && invoice.status !== "Overdue") {
            throw new UnprocessableEntityException({
                error: "Only Due or Overdue invoices can be ignored for MEP",
            });
        }
        if (isNegativeInvoiceAmount(invoice.amount)) {
            throw new UnprocessableEntityException({
                error: "Credit notes cannot be ignored for MEP",
            });
        }

        const updated = await this.db.invoice.update({
            where: { id: invoiceId },
            data: {
                mep_ignored: mepIgnored,
                modified_by: actor,
                modified_at: new Date(),
            },
            select: {
                id: true,
                mep_ignored: true,
                customer_id: true,
                invoice_date: true,
            },
        });

        const customerId = updated.customer_id!;
        await syncCustomerInsuranceFields(customerId);

        const { memberIds } = await resolveCreditPoolMemberIds(
            customerId,
            invoice.account_id
        );
        await enqueueRewriteForImport({
            accountId: invoice.account_id,
            importType: "Invoice",
            entityIds: [invoiceId],
            customerIds: memberIds,
        });

        return serializeBigInt({
            success: true,
            invoice: updated,
        });
    }
}
