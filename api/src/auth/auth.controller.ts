import {
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
    Req,
    Res,
    Query,
    NotFoundException,
    ParseIntPipe,
    BadRequestException,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOkResponse,
    ApiOperation,
    ApiQuery,
    ApiTags,
    ApiUnauthorizedResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
} from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { AuthService, JwtPayload, SsoProviderId } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import {
    AccountBySubdomainResponseDto,
    ForgetPasswordDto,
    LoginResponseDto,
    MeResponseDto,
    MessageResponseDto,
    ResetPasswordDto,
    ScopeProbeResponseDto,
} from "./dto/auth-response.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly configService: ConfigService
    ) {}

    @Post("login")
    @ApiOperation({ summary: "Credentials login — issue Bearer JWT" })
    @ApiOkResponse({ type: LoginResponseDto })
    @ApiUnauthorizedResponse({ description: "Invalid credentials" })
    login(@Body() body: LoginDto): Promise<LoginResponseDto> {
        return this.authService.login(body);
    }

    @Get("me")
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: "Validate Bearer JWT and return profile claims" })
    @ApiOkResponse({ type: MeResponseDto })
    @ApiUnauthorizedResponse({ description: "Missing or invalid token" })
    me(@Req() req: Request & { user: JwtPayload }): Promise<MeResponseDto> {
        return this.authService.getProfile(req.user);
    }

    @Post("forget-password")
    @ApiOperation({ summary: "Request password reset email" })
    @ApiOkResponse({ type: MessageResponseDto })
    forgetPassword(
        @Body() body: ForgetPasswordDto
    ): Promise<MessageResponseDto> {
        if (!body?.email?.trim()) {
            throw new BadRequestException("Email is required");
        }
        return this.authService.requestPasswordReset(
            body.email.trim(),
            body.language
        );
    }

    @Post("reset-password")
    @ApiOperation({ summary: "Reset password with token" })
    @ApiOkResponse({ type: MessageResponseDto })
    resetPassword(@Body() body: ResetPasswordDto): Promise<MessageResponseDto> {
        if (!body?.token?.trim() || !body?.password) {
            throw new BadRequestException("Token and password are required");
        }
        return this.authService.resetPassword(
            body.token.trim(),
            body.password
        );
    }

    @Get("scope-probe")
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: "Account-scope probe — 200 if JWT account_id matches query",
    })
    @ApiQuery({ name: "account_id", type: Number, required: true })
    @ApiOkResponse({ type: ScopeProbeResponseDto })
    @ApiForbiddenResponse({ description: "Account scope mismatch" })
    @ApiUnauthorizedResponse({ description: "Missing or invalid token" })
    scopeProbe(
        @Req() req: Request & { user: JwtPayload },
        @Query("account_id", ParseIntPipe) accountId: number
    ): ScopeProbeResponseDto {
        return this.authService.probeAccountScope(req.user, accountId);
    }

    @Get("account-by-subdomain")
    @ApiOperation({
        summary: "Public SSO discovery by account subdomain",
    })
    @ApiQuery({ name: "subdomain", required: true })
    @ApiOkResponse({ type: AccountBySubdomainResponseDto })
    @ApiNotFoundResponse({ description: "Account not found" })
    accountBySubdomain(
        @Query("subdomain") subdomain?: string
    ): Promise<AccountBySubdomainResponseDto> {
        if (!subdomain?.trim()) {
            throw new BadRequestException("Subdomain parameter is required");
        }
        return this.authService.findAccountBySubdomain(subdomain.trim());
    }

    @Get("google")
    @ApiOperation({ summary: "Start Google OAuth (Nest-owned SSO)" })
    async googleStart(@Res() res: Response): Promise<void> {
        if (!this.authService.isGoogleConfigured()) {
            throw new NotFoundException("Google SSO is not configured");
        }
        res.redirect(`${this.authService.getPublicBaseUrl()}/auth/google/start`);
    }

    @Get("google/start")
    @UseGuards(AuthGuard("google"))
    googleStartPassport(): void {
        // Guard redirects to Google
    }

    @Get("google/callback")
    @UseGuards(AuthGuard("google"))
    async googleCallback(
        @Req() req: Request & { user?: { email?: string } },
        @Res() res: Response
    ): Promise<void> {
        await this.finishSso(req.user?.email, "google", res);
    }

    @Get("azure-ad")
    @ApiOperation({ summary: "Start Azure AD OAuth (Nest-owned SSO)" })
    async azureStart(@Res() res: Response): Promise<void> {
        if (!this.authService.isAzureConfigured()) {
            throw new NotFoundException("Azure AD SSO is not configured");
        }
        res.redirect(
            `${this.authService.getPublicBaseUrl()}/auth/azure-ad/start`
        );
    }

    @Get("azure-ad/start")
    @UseGuards(AuthGuard("azure-ad"))
    azureStartPassport(): void {
        // Guard redirects to Azure AD
    }

    @Get("azure-ad/callback")
    @UseGuards(AuthGuard("azure-ad"))
    async azureCallback(
        @Req() req: Request & { user?: { email?: string } },
        @Res() res: Response
    ): Promise<void> {
        await this.finishSso(req.user?.email, "microsoft", res);
    }

    /**
     * Dev/test SSO completion without IdP round-trip.
     * Enabled only when AUTH_SSO_SIMULATE=1.
     */
    @Get("sso/simulate")
    @ApiOperation({
        summary: "Simulate SSO callback (AUTH_SSO_SIMULATE=1 only)",
    })
    async simulateSso(
        @Query("email") email: string | undefined,
        @Query("provider") provider: string | undefined,
        @Res() res: Response
    ): Promise<void> {
        if (this.configService.get("AUTH_SSO_SIMULATE") !== "1") {
            throw new NotFoundException();
        }
        const normalizedProvider =
            provider === "azure-ad" || provider === "microsoft"
                ? "microsoft"
                : provider === "google"
                  ? "google"
                  : null;
        if (!normalizedProvider) {
            throw new BadRequestException("provider must be google or microsoft");
        }
        await this.finishSso(email, normalizedProvider, res);
    }

    private async finishSso(
        email: string | null | undefined,
        provider: SsoProviderId,
        res: Response
    ): Promise<void> {
        const result = await this.authService.resolveSsoUser(email, provider);
        if (!result.ok) {
            res.redirect(this.authService.buildErrorRedirectUrl(result.error));
            return;
        }
        const token = await this.authService.issueTokenResponse(result.payload);
        res.redirect(
            this.authService.buildSuccessRedirectUrl(token.access_token)
        );
    }
}
