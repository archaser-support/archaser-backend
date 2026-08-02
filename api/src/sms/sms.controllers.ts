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
import { SmsService } from "./sms.service";

@ApiTags("sms")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/sms")
export class SmsController {
    constructor(private readonly sms: SmsService) {}

    @Get("check-blocking")
    @ApiOperation({ summary: "Check if SMS is blocked for a country" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async checkBlocking(
        @CurrentUser() user: JwtPayload,
        @Query("countryId") countryIdRaw: string,
        @Query("accountId") accountIdRaw?: string
    ) {
        const countryId = Number(countryIdRaw);
        if (!Number.isFinite(countryId)) {
            return { error: "Valid country ID is required" };
        }
        const accountId =
            accountIdRaw && !Number.isNaN(Number(accountIdRaw))
                ? Number(accountIdRaw)
                : undefined;
        return this.sms.checkBlocking(user, countryId, accountId);
    }

    @Get("check-blocking-with-activities")
    @ApiOperation({
        summary: "Check SMS blocking and existing SMS activities",
    })
    async checkBlockingWithActivities(
        @CurrentUser() user: JwtPayload,
        @Query("countryId") countryIdRaw: string,
        @Query("accountId") accountIdRaw: string,
        @Query("customerId") customerIdRaw: string
    ) {
        const countryId = Number(countryIdRaw);
        const accountId = Number(accountIdRaw);
        const customerId = Number(customerIdRaw);
        if (!Number.isFinite(countryId)) {
            return { error: "Valid country ID is required" };
        }
        if (!Number.isFinite(accountId) || !Number.isFinite(customerId)) {
            return { error: "Valid customer ID is required" };
        }
        return this.sms.checkBlockingWithActivities(
            user,
            countryId,
            accountId,
            customerId
        );
    }

    @Post("test")
    @ApiOperation({ summary: "Send a test SMS (Nest-native stub)" })
    async test(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.sms.testSms(user, body);
    }
}

@ApiTags("sms-vendors")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/sms/vendors")
export class SmsVendorsController {
    constructor(private readonly sms: SmsService) {}

    @Get()
    @ApiOperation({ summary: "List SMS vendors" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: Record<string, string | undefined>
    ) {
        return this.sms.listVendors(user, query);
    }

    @Post()
    @ApiOperation({ summary: "Create SMS vendor" })
    async create(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.sms.createVendor(user, body);
    }

    @Get(":id")
    @ApiOperation({ summary: "Get SMS vendor" })
    async byId(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.sms.getVendor(user, id);
    }

    @Put(":id")
    @ApiOperation({ summary: "Update SMS vendor" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.sms.updateVendor(user, id, body);
    }

    @Delete(":id")
    @ApiOperation({ summary: "Delete SMS vendor" })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.sms.deleteVendor(user, id);
    }
}

@ApiTags("sms-country-vendors")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/sms/country-vendors")
export class SmsCountryVendorsController {
    constructor(private readonly sms: SmsService) {}

    @Get()
    @ApiOperation({ summary: "List country–vendor mappings" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: Record<string, string | undefined>
    ) {
        return this.sms.listCountryVendors(user, query);
    }

    @Post()
    @ApiOperation({ summary: "Create country–vendor mapping" })
    async create(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.sms.createCountryVendor(user, body);
    }

    @Get(":id")
    @ApiOperation({ summary: "Get country–vendor mapping" })
    async byId(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.sms.getCountryVendor(user, id);
    }

    @Put(":id")
    @ApiOperation({ summary: "Update country–vendor mapping" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.sms.updateCountryVendor(user, id, body);
    }

    @Delete(":id")
    @ApiOperation({ summary: "Delete country–vendor mapping" })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.sms.deleteCountryVendor(user, id);
    }
}

/** Public Twilio delivery webhook — no DualAuth (legacy SoftDualAuth public). */
@ApiTags("sms-webhook")
@Controller("api/sms/webhook")
export class SmsWebhookController {
    constructor(private readonly sms: SmsService) {}

    @Post("twilio")
    @ApiOperation({ summary: "Twilio SMS delivery webhook (public)" })
    async twilio(@Body() body: Record<string, unknown>) {
        return this.sms.handleTwilioWebhook(body);
    }
}
