import {
    Body,
    Controller,
    Delete,
    Get,
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
import { CustomerCheckpointService } from "./customer-checkpoint.service";
import {
    CustomerActivityQuery,
    CustomersListQuery,
    CustomersService,
    CustomerTopUpsQuery,
} from "./customers.service";

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/customers")
export class CustomersController {
    constructor(
        private readonly customers: CustomersService,
        private readonly checkpoints: CustomerCheckpointService
    ) {}

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

    @Get(":id/top-ups")
    @ApiOperation({ summary: "Customer top-ups list (Nest-native)" })
    async topUps(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Query() query: CustomerTopUpsQuery
    ) {
        return this.customers.listTopUps(user, id, query);
    }

    @Post(":id/top-ups")
    @ApiOperation({ summary: "Create a customer top-up (Nest-native)" })
    async createTopUp(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.customers.createTopUp(user, id, body);
    }

    @Delete(":id/top-ups/:topUpId")
    @ApiOperation({ summary: "Cancel a customer top-up (Nest-native)" })
    async cancelTopUp(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Param("topUpId", ParseIntPipe) topUpId: number
    ) {
        return this.customers.cancelTopUp(user, id, topUpId);
    }

    @Get(":id/checkpoint")
    @ApiOperation({ summary: "Customer checkpoint status (non-production only)" })
    async checkpointStatus(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.checkpoints.getStatus(user, id);
    }

    @Post(":id/checkpoint/save")
    @ApiOperation({ summary: "Save a customer checkpoint (non-production only)" })
    async checkpointSave(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.checkpoints.save(user, id);
    }

    @Post(":id/checkpoint/restore")
    @ApiOperation({
        summary: "Restore a customer checkpoint (non-production only)",
    })
    async checkpointRestore(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.checkpoints.restore(user, id);
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
