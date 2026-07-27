import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AccessScopeService } from "../auth/access-scope.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

/** Leaf route `/api/bank-accounts` (distinct from entities/bank-accounts). */
@ApiTags("bank-accounts")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/bank-accounts")
export class BankAccountsLeafController {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    @Get()
    @ApiOperation({
        summary: "Active account bank accounts leaf (Nest-native)",
    })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query("accountId") accountIdRaw?: string,
        @Query("include") include?: string
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const sessionAccount =
            this.accessScope.getEffectiveAccountId(userInfo);
        const targetAccountId = accountIdRaw
            ? parseInt(accountIdRaw, 10)
            : sessionAccount;
        if (!targetAccountId || !Number.isFinite(targetAccountId)) {
            return { error: "Customer ID is required" };
        }
        const includeCountry = include?.includes("Country");
        const accounts = await this.db.accountBankAccounts.findMany({
            where: {
                account_id: targetAccountId,
                status: true,
            },
            include: includeCountry ? { Country: true } : undefined,
            orderBy: { bank_name: "asc" },
        });
        return serializeBigInt(accounts);
    }
}
