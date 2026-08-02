import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
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
import { AccountAdminEntitiesService } from "./account-admin-entities.service";

/**
 * Nested BU ↔ bank junction routes (staging `business-unit-banks` handlers).
 * Path shape: `/api/entities/business-unit-banks/:businessUnitId[/:junctionId]`
 */
@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/business-unit-banks")
export class BusinessUnitBanksController {
    constructor(private readonly service: AccountAdminEntitiesService) {}

    @Get(":businessUnitId")
    @ApiOperation({
        summary: "List bank accounts assigned to a business unit",
    })
    @ApiUnauthorizedResponse({
        description: "Missing Bearer or session cookie",
    })
    async list(
        @CurrentUser() user: JwtPayload,
        @Param("businessUnitId") businessUnitId: string
    ) {
        return this.service.listBusinessUnitBanks(user, businessUnitId);
    }

    @Post(":businessUnitId")
    @ApiOperation({ summary: "Assign a bank account to a business unit" })
    async add(
        @CurrentUser() user: JwtPayload,
        @Param("businessUnitId") businessUnitId: string,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.addBusinessUnitBank(user, businessUnitId, body);
    }

    @Delete(":businessUnitId/:junctionId")
    @ApiOperation({
        summary: "Remove a bank account assignment from a business unit",
    })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("businessUnitId") businessUnitId: string,
        @Param("junctionId") junctionId: string
    ) {
        return this.service.removeBusinessUnitBank(
            user,
            businessUnitId,
            junctionId
        );
    }
}
