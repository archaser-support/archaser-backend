import {
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Put,
    Post,
    Body,
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
    CustomerActivityQuery,
    CustomersListQuery,
    CustomersService,
} from "./customers.service";

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/customers")
export class CustomersController {
    constructor(private readonly customers: CustomersService) {}

    @Get()
    @ApiOperation({ summary: "Customers list / stats (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: CustomersListQuery
    ) {
        return this.customers.listOrStats(user, query);
    }

    @Get(":id")
    @ApiOperation({ summary: "Customer detail (Nest-native)" })
    async byId(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.customers.getById(user, id);
    }

    @Put(":id")
    @ApiOperation({ summary: "Customer update (Nest-native)" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.customers.update(user, id, body);
    }

    @Get(":id/activity")
    @ApiOperation({ summary: "Customer activity feed (Nest-native)" })
    async activity(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Query() query: CustomerActivityQuery
    ) {
        return this.customers.listActivities(user, id, query);
    }

    @Get(":id/disputes")
    @ApiOperation({ summary: "Customer disputes list (Nest-native)" })
    async disputes(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.customers.listDisputes(user, id);
    }

    @Get(":id/policies")
    @ApiOperation({ summary: "Customer policies list (Nest-native)" })
    async policies(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.customers.listPolicies(user, id);
    }

    @Get(":id/stuck-activities")
    @ApiOperation({ summary: "Customer stuck-activities flag (Nest-native)" })
    async stuckActivities(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.customers.stuckActivities(user, id);
    }

    @Post(":id/activity/log-call-activity")
    @ApiOperation({ summary: "Log a call activity (Nest-native)" })
    async logCallActivity(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.customers.logCallActivity(user, id, body);
    }

    @Post(":id/activity/send-email")
    @ApiOperation({ summary: "Send a customer email activity (Nest-native)" })
    async sendEmail(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.customers.sendEmailActivity(user, id, body);
    }

    @Put(":id/disputes/:disputeId/:op")
    @ApiOperation({ summary: "Update a customer dispute (Nest-native)" })
    async updateDispute(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Param("disputeId", ParseIntPipe) disputeId: number,
        @Param("op") op: string,
        @Body() body: Record<string, unknown>
    ) {
        return this.customers.updateDispute(user, id, disputeId, op, body);
    }
}
