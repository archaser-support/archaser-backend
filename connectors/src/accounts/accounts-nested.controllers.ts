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
import { JwtPayload } from "../auth/jwt-payload";
import { AccountsNestedService } from "./accounts-nested.service";

@ApiTags("accounts")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/accounts")
export class AccountsController {
    constructor(private readonly service: AccountsNestedService) {}

    @Get(":accountId")
    @ApiOperation({ summary: "Account by id (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async byId(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number
    ) {
        return this.service.getAccount(user, accountId);
    }

    @Get(":accountId/sms-preferences")
    @ApiOperation({ summary: "List account SMS preferences" })
    async listSmsPrefs(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Query("country_id") countryId?: string
    ) {
        return this.service.listSmsPreferences(user, accountId, countryId);
    }

    @Post(":accountId/sms-preferences")
    @ApiOperation({ summary: "Create account SMS preference" })
    async createSmsPref(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.createSmsPreference(user, accountId, body);
    }

    @Get(":accountId/sms-preferences/:preferenceId")
    @ApiOperation({ summary: "Get SMS preference by id" })
    async getSmsPref(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("preferenceId", ParseIntPipe) preferenceId: number
    ) {
        return this.service.getSmsPreference(user, accountId, preferenceId);
    }

    @Put(":accountId/sms-preferences/:preferenceId")
    @ApiOperation({ summary: "Update SMS preference" })
    async updateSmsPref(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("preferenceId", ParseIntPipe) preferenceId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.updateSmsPreference(
            user,
            accountId,
            preferenceId,
            body
        );
    }

    @Delete(":accountId/sms-preferences/:preferenceId")
    @ApiOperation({ summary: "Delete SMS preference" })
    async deleteSmsPref(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("preferenceId", ParseIntPipe) preferenceId: number
    ) {
        return this.service.deleteSmsPreference(user, accountId, preferenceId);
    }

    @Put(":accountId/generic-field-config")
    @ApiOperation({ summary: "Update generic field config" })
    async genericFieldConfig(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.updateGenericFieldConfig(user, accountId, body);
    }
}

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/users")
export class CheckUsernameController {
    constructor(private readonly service: AccountsNestedService) {}

    @Get("check-username")
    @ApiOperation({ summary: "Check username availability (Nest-native)" })
    async check(
        @Query("username") username: string,
        @Query("excludeUserId") excludeUserId?: string
    ) {
        if (!username || typeof username !== "string") {
            return {
                success: false,
                error: "Username is required",
            };
        }
        return this.service.checkUsername(username, excludeUserId);
    }
}

@ApiTags("billing-connector")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/accounts/:accountId/billing-connector")
export class BillingConnectorController {
    constructor(private readonly service: AccountsNestedService) {}

    @Get()
    @ApiOperation({ summary: "Get billing connector config" })
    async get(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number
    ) {
        return this.service.getBillingConnector(user, accountId);
    }

    @Put()
    @ApiOperation({ summary: "Upsert billing connector config" })
    async put(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.upsertBillingConnector(user, accountId, body);
    }

    @Post("test")
    @ApiOperation({ summary: "Test billing connector connection" })
    async test(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.billingConnectorAction(
            user,
            accountId,
            "test",
            body
        );
    }

    @Post("sync")
    @ApiOperation({ summary: "Trigger billing connector sync" })
    async sync(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>,
        @Query("mode") mode?: string
    ) {
        return this.service.billingConnectorAction(
            user,
            accountId,
            "sync",
            {
                ...(body ?? {}),
                ...(mode ? { mode } : {}),
            }
        );
    }

    @Get("sync-runs")
    @ApiOperation({ summary: "List billing connector sync runs" })
    async syncRuns(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number
    ) {
        return this.service.billingConnectorAction(
            user,
            accountId,
            "sync-runs"
        );
    }

    @Post("backfill/reset")
    @ApiOperation({ summary: "Reset billing connector backfill" })
    async backfillReset(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number
    ) {
        return this.service.billingConnectorAction(
            user,
            accountId,
            "backfill-reset"
        );
    }

    @Get("mappings/:importType")
    @ApiOperation({ summary: "Get field mappings for import type" })
    async getMappings(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("importType") importType: string
    ) {
        return this.service.getBillingMappings(user, accountId, importType);
    }

    @Put("mappings/:importType")
    @ApiOperation({ summary: "Upsert field mappings for import type" })
    async putMappings(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("importType") importType: string,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.putBillingMappings(
            user,
            accountId,
            importType,
            body
        );
    }

    @Get("discover-fields/:importType")
    @ApiOperation({ summary: "Discover fields for import type" })
    async discover(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("importType") importType: string
    ) {
        return this.service.discoverBillingFields(
            user,
            accountId,
            importType
        );
    }
}

@ApiTags("notification-rule-sets")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/accounts/:accountId/notification-rule-sets")
export class NotificationRuleSetsController {
    constructor(private readonly service: AccountsNestedService) {}

    @Get()
    @ApiOperation({ summary: "List credit insurance notification rule sets" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number
    ) {
        return this.service.listNotificationRuleSets(user, accountId);
    }

    @Put(":setId")
    @ApiOperation({ summary: "Update a notification rule set" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("setId", ParseIntPipe) setId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.updateNotificationRuleSet(
            user,
            accountId,
            setId,
            body
        );
    }
}
