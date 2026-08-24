import { All, Body, Controller, Param, Query, UseGuards } from "@nestjs/common";
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
import { CreditInsuranceService } from "./credit-insurance.service";

const CREDIT_INSURANCE_KEYS = [
    "summary",
    "summary-history",
    "portfolio-health",
    "customer-dashboard-kpis",
    "customer-policy-trend",
    "report",
    "insurance-policy-trend",
    "mark-reported",
    "mark-reported-bulk",
    "asof-backfill-status",
    "asof-backfill-start",
    "asof-backfill-pause",
    "asof-backfill-retry",
];

@ApiTags("credit-insurance")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/credit-insurance")
export class CreditInsuranceDomainController {
    constructor(private readonly creditInsurance: CreditInsuranceService) {}

    @All(":leaf")
    @ApiParam({
        name: "leaf",
        enum: CREDIT_INSURANCE_KEYS,
        description: "Credit insurance KPI / action leaf",
    })
    @ApiOperation({
        summary: "Credit insurance KPIs/dashboards (Nest-native)",
    })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async handle(
        @Param("leaf") leaf: string,
        @CurrentUser() user: JwtPayload,
        @Query() query: Record<string, unknown>,
        @Body() body: Record<string, unknown>
    ) {
        return this.creditInsurance.handle(leaf, user, query, body);
    }
}
