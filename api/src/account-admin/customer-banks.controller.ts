import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
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
import {
    AccountAdminEntitiesService,
    AccountAdminListQuery,
} from "./account-admin-entities.service";

/**
 * Customer ↔ bank junction routes.
 * Path shape: `/api/entities/customer-banks[/:customerId[/:junctionId]]`
 *
 * Kept off the generic account-admin `:id` controller so `:customerId` is not
 * mistaken for a CustomerBanks primary key.
 */
@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/customer-banks")
export class CustomerBanksController {
    constructor(private readonly service: AccountAdminEntitiesService) {}

    @Get()
    @ApiOperation({ summary: "List customer-bank rows (account-scoped)" })
    @ApiUnauthorizedResponse({
        description: "Missing Bearer or session cookie",
    })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: AccountAdminListQuery
    ) {
        return this.service.list("customer-banks", user, query);
    }

    @Get(":customerId")
    @ApiOperation({ summary: "List banks assigned to a customer" })
    async listForCustomer(
        @CurrentUser() user: JwtPayload,
        @Param("customerId") customerId: string,
        @Query() query: AccountAdminListQuery
    ) {
        return this.service.listCustomerBanks(user, customerId, query);
    }

    @Post(":customerId")
    @ApiOperation({ summary: "Assign a bank account to a customer" })
    async add(
        @CurrentUser() user: JwtPayload,
        @Param("customerId") customerId: string,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.addCustomerBank(user, customerId, body);
    }

    @Delete(":customerId/:junctionId")
    @ApiOperation({ summary: "Remove a bank assignment from a customer" })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("customerId") customerId: string,
        @Param("junctionId") junctionId: string
    ) {
        return this.service.removeCustomerBank(user, customerId, junctionId);
    }
}
