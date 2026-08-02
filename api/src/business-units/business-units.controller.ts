import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { BusinessUnitsService } from "./business-units.service";

@ApiTags("business-units")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/business-units")
export class BusinessUnitsController {
    constructor(private readonly businessUnits: BusinessUnitsService) {}

    @Post("validate-access")
    @HttpCode(200)
    @ApiOperation({
        summary: "Validate user access to business units by external id",
    })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async validateAccess(
        @CurrentUser() user: JwtPayload,
        @Body() body: { externalIds?: string[] }
    ) {
        return this.businessUnits.validateAccess(user, body.externalIds ?? []);
    }
}
