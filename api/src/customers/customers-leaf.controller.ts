import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { CustomersService } from "./customers.service";

/**
 * Leaf routes under `/api/customers/*` (not `/api/entities/customers`).
 * Kept for import validation + typeahead search call sites.
 */
@ApiTags("customers")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/customers")
export class CustomersLeafController {
    constructor(private readonly customers: CustomersService) {}

    @Get("search")
    @ApiOperation({ summary: "Customer typeahead search" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async search(
        @CurrentUser() user: JwtPayload,
        @Query("q") q?: string,
        @Query("excludeId") excludeId?: string
    ) {
        return this.customers.searchCustomers(user, {
            q,
            excludeId: excludeId ? parseInt(excludeId, 10) : undefined,
        });
    }

    @Get("aggregated-data/:customerId")
    @ApiOperation({ summary: "Parent customer aggregated child metrics" })
    async aggregatedData(
        @CurrentUser() user: JwtPayload,
        @Param("customerId", ParseIntPipe) customerId: number
    ) {
        return this.customers.getAggregatedData(user, customerId);
    }

    @Post("validate-business-unit-access")
    @HttpCode(200)
    @ApiOperation({
        summary: "Validate access to customers by customer number (import)",
    })
    async validateBusinessUnitAccess(
        @CurrentUser() user: JwtPayload,
        @Body() body: { customerNumbers?: Array<string | number> }
    ) {
        return this.customers.validateBusinessUnitAccess(
            user,
            body.customerNumbers ?? []
        );
    }
}
