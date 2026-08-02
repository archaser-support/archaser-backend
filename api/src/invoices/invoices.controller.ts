import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Query,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { InvoicesListQuery, InvoicesService } from "./invoices.service";

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/invoices")
export class InvoicesController {
    constructor(private readonly invoices: InvoicesService) {}

    @Get("status")
    @ApiOperation({ summary: "Invoice status catalog" })
    async statuses() {
        return this.invoices.listStatuses();
    }

    @Get("available-for-credit/:customerId")
    @ApiOperation({ summary: "Open invoices that can receive credit" })
    async availableForCredit(
        @CurrentUser() user: JwtPayload,
        @Param("customerId", ParseIntPipe) customerId: number
    ) {
        return this.invoices.availableForCredit(user, customerId);
    }

    @Post("assign-credit")
    @HttpCode(200)
    @ApiOperation({ summary: "Assign a credit invoice to a target invoice" })
    async assignCredit(
        @CurrentUser() user: JwtPayload,
        @Body()
        body: { creditInvoiceId?: number; targetInvoiceId?: number }
    ) {
        return this.invoices.assignCredit(user, body);
    }

    @Get()
    @ApiOperation({ summary: "Invoices list (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: InvoicesListQuery
    ) {
        return this.invoices.list(user, query);
    }

    @Get(":id")
    @ApiOperation({ summary: "Invoice detail (Nest-native)" })
    async byId(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.invoices.getById(user, id);
    }

    @Put(":id")
    @ApiOperation({ summary: "Invoice update (Nest-native)" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.invoices.update(user, id, body);
    }
}
