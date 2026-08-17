import {
    BadRequestException,
    Body,
    Controller,
    ForbiddenException,
    Get,
    NotFoundException,
    Param,
    ParseIntPipe,
    Post,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
import {
    getAsOfBackfillStatus,
    pauseAsOfBackfill,
    resumeAsOfBackfill,
    startAsOfBackfill,
} from "./domain/asOfBackfillService";

const ARCHASER_SUPER_ADMIN_ACCOUNT_ID = 10013;

@ApiTags("credit-insurance")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/credit-insurance/as-of-backfill")
export class AsOfBackfillController {
    constructor(private readonly db: DatabaseService) {}

    @Get(":accountId")
    @ApiParam({ name: "accountId", type: Number })
    @ApiOperation({ summary: "Get as-of backfill status" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async getStatus(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number
    ) {
        await this.assertAllowed(user, accountId);
        return getAsOfBackfillStatus(accountId);
    }

    @Post(":accountId")
    @ApiParam({ name: "accountId", type: Number })
    @ApiOperation({ summary: "Start, pause, or resume as-of backfill" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async act(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: { action?: unknown }
    ) {
        await this.assertAllowed(user, accountId);

        switch (body?.action) {
            case "start":
                return startAsOfBackfill(accountId, user.sub ?? null);
            case "pause":
                return pauseAsOfBackfill(accountId);
            case "resume":
                return resumeAsOfBackfill(accountId);
            default:
                throw new BadRequestException({
                    error: "action must be one of: start, pause, resume",
                });
        }
    }

    private async assertAllowed(user: JwtPayload, accountId: number): Promise<void> {
        if (!Number.isFinite(accountId) || accountId <= 0) {
            throw new BadRequestException({ error: "Invalid account id" });
        }
        // Deliberately use the authenticated session account, never view-as scope.
        if (user.account_id !== ARCHASER_SUPER_ADMIN_ACCOUNT_ID) {
            throw new ForbiddenException({
                error: "Only ARchaser administrators can run as-of backfill",
            });
        }

        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { id: true, has_credit_insurance: true },
        });
        if (!account) {
            throw new NotFoundException({ error: "Account not found" });
        }
        if (!account.has_credit_insurance) {
            throw new BadRequestException({
                error: "Credit insurance is not enabled for this account",
            });
        }
    }
}
