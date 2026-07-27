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
import { SearchService } from "./search.service";

@ApiTags("search")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/search")
export class SearchController {
    constructor(private readonly search: SearchService) {}

    @Get("global")
    @ApiOperation({ summary: "Global search across customers, invoices, contacts, disputes" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async global(
        @CurrentUser() user: JwtPayload,
        @Query("q") q?: string
    ) {
        return this.search.globalSearch(user, q);
    }
}
