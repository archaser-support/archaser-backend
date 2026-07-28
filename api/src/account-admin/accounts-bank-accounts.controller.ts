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
import {
    AccountAdminEntitiesService,
    AccountAdminListQuery,
} from "./account-admin-entities.service";

/**
 * Nested legacy path used by Settings → Bank Accounts:
 * /api/entities/accounts/:accountId/bank-accounts
 */
@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/accounts/:accountId/bank-accounts")
export class AccountsBankAccountsController {
    constructor(private readonly service: AccountAdminEntitiesService) {}

    @Get()
    @ApiOperation({
        summary: "List bank accounts for an account (Nest-native)",
    })
    @ApiUnauthorizedResponse({
        description: "Missing Bearer or session cookie",
    })
    async list(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Query() query: AccountAdminListQuery
    ) {
        return this.service.listAccountBankAccounts(user, accountId, query);
    }

    @Post()
    @ApiOperation({ summary: "Create bank account for an account" })
    async create(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.createAccountBankAccount(user, accountId, body);
    }

    @Put(":id")
    @ApiOperation({ summary: "Update bank account for an account" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.updateAccountBankAccount(
            user,
            accountId,
            id,
            body
        );
    }

    @Delete(":id")
    @ApiOperation({ summary: "Delete bank account for an account" })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.service.deleteAccountBankAccount(user, accountId, id);
    }
}
