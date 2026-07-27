import {
    Body,
    Controller,
    Get,
    Param,
    ParseIntPipe,
    Put,
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
import { CollectionPeriodService } from "./collection-period.service";

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/customer-collection-period")
export class CollectionPeriodController {
    constructor(private readonly collectionPeriod: CollectionPeriodService) {}

    @Get(":id")
    @ApiOperation({ summary: "Collection period detail (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async byId(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.collectionPeriod.getById(user, id);
    }

    @Put(":id")
    @ApiOperation({ summary: "Collection period category update (Nest-native)" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.collectionPeriod.update(user, id, body);
    }
}
