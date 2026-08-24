import { All, Body, Controller, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { PortalService } from "./portal.service";

/**
 * Public Customer Portal routes. No DualAuthGuard — Nest-native handlers
 * enforce their own portal UUID lookups (captcha/rate-limiting stays out of
 * scope for this pragmatic port).
 */
@ApiTags("portal")
@Controller("api/portal")
export class PortalDomainController {
    constructor(private readonly portal: PortalService) {}

    @Post("create-dispute")
    @ApiOperation({ summary: "Portal create-dispute (public, Nest-native)" })
    async createDispute(@Body() body: Record<string, unknown>) {
        return this.portal.createPublicDispute(body);
    }

    @Post("send-verification-code")
    @ApiOperation({ summary: "Portal send verification code" })
    async sendVerificationCode(@Body() body: Record<string, unknown>) {
        return this.portal.sendVerificationCode(body);
    }

    @Post("verify-code")
    @ApiOperation({ summary: "Portal verify email code" })
    async verifyCode(@Body() body: Record<string, unknown>) {
        return this.portal.verifyCode(body);
    }

    @Post("verification-email")
    @ApiOperation({ summary: "Portal contact email for verification" })
    async verificationEmail(@Body() body: Record<string, unknown>) {
        return this.portal.verificationEmail(body);
    }

    @Post("update-promise-to-pay")
    @ApiOperation({
        summary: "Portal update-promise-to-pay (public, Nest-native)",
    })
    async updatePromise(@Body() body: Record<string, unknown>) {
        return this.portal.updatePromiseToPay(body);
    }
}

const PORTAL_SUFFIXES = [
    "portal-data",
    "agent-portal",
    "invoices",
    "bank-details",
    "banks",
    "disputes",
    "create-dispute",
    "view-disputes",
    "wrong-contact",
] as const;

@ApiTags("portal-customers")
@Controller("api/customers")
export class PortalCustomersDomainController {
    constructor(private readonly portal: PortalService) {}

    /**
     * Read-only portal bootstrap leaves. Kept separate from POST so a page load
     * can never be routed into a create handler.
     */
    @All(":customerUUID/:suffix")
    @ApiParam({ name: "customerUUID", description: "Portal customer UUID" })
    @ApiParam({
        name: "suffix",
        enum: PORTAL_SUFFIXES,
        description: "Public portal leaf",
    })
    @ApiOperation({
        summary: "Public portal customer UUID routes (Nest-native)",
    })
    async publicPortalRoute(
        @Param("customerUUID") customerUUID: string,
        @Param("suffix") suffix: string,
        @Query("language") language?: string
    ) {
        return this.portal.handleSuffix(customerUUID, suffix, language);
    }
}
