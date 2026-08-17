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
import { AccountsSmsPreferencesService } from "./accounts-sms-preferences.service";

@ApiTags("accounts")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/accounts")
export class AccountsSmsPreferencesController {
    constructor(private readonly service: AccountsSmsPreferencesService) {}

    @Get(":accountId/sms-preferences")
    @ApiOperation({ summary: "List account SMS preferences" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Query("country_id") countryId?: string
    ) {
        return this.service.list(user, accountId, countryId);
    }

    @Post(":accountId/sms-preferences")
    @ApiOperation({ summary: "Create account SMS preference" })
    async create(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.create(user, accountId, body);
    }

    @Get(":accountId/sms-preferences/:preferenceId")
    @ApiOperation({ summary: "Get SMS preference by id" })
    async getById(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("preferenceId", ParseIntPipe) preferenceId: number
    ) {
        return this.service.getById(user, accountId, preferenceId);
    }

    @Put(":accountId/sms-preferences/:preferenceId")
    @ApiOperation({ summary: "Update SMS preference" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("preferenceId", ParseIntPipe) preferenceId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.update(user, accountId, preferenceId, body);
    }

    @Delete(":accountId/sms-preferences/:preferenceId")
    @ApiOperation({ summary: "Delete SMS preference" })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("preferenceId", ParseIntPipe) preferenceId: number
    ) {
        return this.service.remove(user, accountId, preferenceId);
    }
}
