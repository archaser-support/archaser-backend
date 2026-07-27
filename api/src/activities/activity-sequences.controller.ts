import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { ActivitiesService } from "./activities.service";

@ApiTags("activitySequences")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/activitySequences")
export class ActivitySequencesController {
    constructor(private readonly activities: ActivitiesService) {}

    @Get()
    @ApiOperation({
        summary: "List activity sequences (alias of /api/activities/sequences)",
    })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: { account_id?: string; sequence_container_id?: string }
    ) {
        return this.activities.listSequences(user, query);
    }

    @Get("activityTemplates")
    @ApiOperation({
        summary: "List activity templates (alias of /api/activities/templates)",
    })
    async activityTemplates(
        @CurrentUser() user: JwtPayload,
        @Query() query: Record<string, string | undefined>
    ) {
        return this.activities.listTemplates(user, query);
    }
}
