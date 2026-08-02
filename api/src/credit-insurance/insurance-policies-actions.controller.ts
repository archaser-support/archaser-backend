import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
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
import { InsuranceEntitiesService } from "./insurance-entities.service";

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/insurance-policies")
export class InsurancePoliciesActionsController {
    constructor(private readonly insurance: InsuranceEntitiesService) {}

    @Post("bulk-replace")
    @HttpCode(200)
    @ApiOperation({ summary: "Reassign customers from one policy to another" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async bulkReplace(
        @CurrentUser() user: JwtPayload,
        @Body() body: { oldPolicyId?: number; newPolicyId?: number }
    ) {
        return this.insurance.bulkReplacePolicy(user, body);
    }

    @Get(":id/customer-prefill")
    @ApiOperation({
        summary: "Prefill customer insurance fields from policy / named / country",
    })
    async customerPrefill(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Query() query: Record<string, string | undefined>
    ) {
        return this.insurance.customerPrefill(user, id, query);
    }
}
