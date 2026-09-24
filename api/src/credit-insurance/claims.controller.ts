import {
    Body,
    Controller,
    Get,
    HttpCode,
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
import { ClaimsListQuery, ClaimsService } from "./claims.service";

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/claims")
export class ClaimsController {
    constructor(private readonly claims: ClaimsService) {}

    @Get()
    @ApiOperation({ summary: "List claims for the effective account" })
    @ApiUnauthorizedResponse({
        description: "Missing Bearer or session cookie",
    })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: ClaimsListQuery
    ) {
        return this.claims.list(user, query);
    }

    @Get("remaining-excess")
    @ApiOperation({
        summary:
            "Remaining Aggregate/SDL excess for a Primary policy year after applied claims",
    })
    async remainingExcess(
        @CurrentUser() user: JwtPayload,
        @Query()
        query: { insurance_policy_id?: string; policy_year?: string }
    ) {
        return this.claims.remainingExcess(user, query);
    }

    @Get("policy-excess-summary")
    @ApiOperation({
        summary:
            "Remaining Aggregate/SDL excess (and optional claims) for Primary policy anniversary years",
    })
    async policyExcessSummary(
        @CurrentUser() user: JwtPayload,
        @Query()
        query: {
            insurance_policy_id?: string;
            recent_years?: string;
            include_claims?: string;
            as_of?: string;
        }
    ) {
        return this.claims.policyExcessSummary(user, query);
    }

    @Get("eligibility/:invoiceId")
    @ApiOperation({
        summary: "Evaluate Issue Claim eligibility for an invoice",
    })
    async eligibility(
        @CurrentUser() user: JwtPayload,
        @Param("invoiceId", ParseIntPipe) invoiceId: number
    ) {
        return this.claims.checkEligibilityForInvoice(user, invoiceId);
    }

    @Post()
    @HttpCode(200)
    @ApiOperation({ summary: "Create a claim (Primary policy ownership)" })
    async create(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.claims.create(user, body);
    }

    @Get(":id")
    @ApiOperation({ summary: "Get claim by id" })
    async getById(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.claims.getById(user, id);
    }

    @Put(":id")
    @ApiOperation({ summary: "Update claim (status, amounts, references)" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.claims.update(user, id, body);
    }
}
