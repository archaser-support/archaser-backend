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
import { SmsCountryVendorsService } from "./sms-country-vendors.service";

@ApiTags("sms-country-vendors")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/sms/country-vendors")
export class SmsCountryVendorsController {
    constructor(private readonly service: SmsCountryVendorsService) {}

    @Get()
    @ApiOperation({ summary: "List country–vendor mappings" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: Record<string, string | undefined>
    ) {
        return this.service.list(user, query);
    }

    @Post()
    @ApiOperation({ summary: "Create country–vendor mapping" })
    async create(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.create(user, body);
    }

    @Get(":id")
    @ApiOperation({ summary: "Get country–vendor mapping" })
    async getById(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.service.getById(user, id);
    }

    @Put(":id")
    @ApiOperation({ summary: "Update country–vendor mapping" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.update(user, id, body);
    }

    @Delete(":id")
    @ApiOperation({ summary: "Delete country–vendor mapping" })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.service.remove(user, id);
    }
}
