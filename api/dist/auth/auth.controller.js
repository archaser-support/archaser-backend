"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const passport_1 = require("@nestjs/passport");
const config_1 = require("@nestjs/config");
const auth_service_1 = require("./auth.service");
const login_dto_1 = require("./dto/login.dto");
const auth_response_dto_1 = require("./dto/auth-response.dto");
const jwt_auth_guard_1 = require("./jwt-auth.guard");
let AuthController = class AuthController {
    constructor(authService, configService) {
        this.authService = authService;
        this.configService = configService;
    }
    login(body) {
        return this.authService.login(body);
    }
    me(req) {
        return this.authService.getProfile(req.user);
    }
    forgetPassword(body) {
        if (!body?.email?.trim()) {
            throw new common_1.BadRequestException("Email is required");
        }
        return this.authService.requestPasswordReset(body.email.trim(), body.language);
    }
    resetPassword(body) {
        if (!body?.token?.trim() || !body?.password) {
            throw new common_1.BadRequestException("Token and password are required");
        }
        return this.authService.resetPassword(body.token.trim(), body.password);
    }
    scopeProbe(req, accountId) {
        return this.authService.probeAccountScope(req.user, accountId);
    }
    accountBySubdomain(subdomain) {
        if (!subdomain?.trim()) {
            throw new common_1.BadRequestException("Subdomain parameter is required");
        }
        return this.authService.findAccountBySubdomain(subdomain.trim());
    }
    async googleStart(res) {
        if (!this.authService.isGoogleConfigured()) {
            throw new common_1.NotFoundException("Google SSO is not configured");
        }
        res.redirect(`${this.authService.getPublicBaseUrl()}/auth/google/start`);
    }
    googleStartPassport() {
    }
    async googleCallback(req, res) {
        await this.finishSso(req.user?.email, "google", res);
    }
    async azureStart(res) {
        if (!this.authService.isAzureConfigured()) {
            throw new common_1.NotFoundException("Azure AD SSO is not configured");
        }
        res.redirect(`${this.authService.getPublicBaseUrl()}/auth/azure-ad/start`);
    }
    azureStartPassport() {
    }
    async azureCallback(req, res) {
        await this.finishSso(req.user?.email, "microsoft", res);
    }
    async simulateSso(email, provider, res) {
        if (this.configService.get("AUTH_SSO_SIMULATE") !== "1") {
            throw new common_1.NotFoundException();
        }
        const normalizedProvider = provider === "azure-ad" || provider === "microsoft"
            ? "microsoft"
            : provider === "google"
                ? "google"
                : null;
        if (!normalizedProvider) {
            throw new common_1.BadRequestException("provider must be google or microsoft");
        }
        await this.finishSso(email, normalizedProvider, res);
    }
    async finishSso(email, provider, res) {
        const result = await this.authService.resolveSsoUser(email, provider);
        if (!result.ok) {
            res.redirect(this.authService.buildErrorRedirectUrl(result.error));
            return;
        }
        const token = await this.authService.issueTokenResponse(result.payload);
        res.redirect(this.authService.buildSuccessRedirectUrl(token.access_token));
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)("login"),
    (0, swagger_1.ApiOperation)({ summary: "Credentials login — issue Bearer JWT" }),
    (0, swagger_1.ApiOkResponse)({ type: auth_response_dto_1.LoginResponseDto }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Invalid credentials" }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Get)("me"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: "Validate Bearer JWT and return profile claims" }),
    (0, swagger_1.ApiOkResponse)({ type: auth_response_dto_1.MeResponseDto }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing or invalid token" }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
__decorate([
    (0, common_1.Post)("forget-password"),
    (0, swagger_1.ApiOperation)({ summary: "Request password reset email" }),
    (0, swagger_1.ApiOkResponse)({ type: auth_response_dto_1.MessageResponseDto }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_response_dto_1.ForgetPasswordDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "forgetPassword", null);
__decorate([
    (0, common_1.Post)("reset-password"),
    (0, swagger_1.ApiOperation)({ summary: "Reset password with token" }),
    (0, swagger_1.ApiOkResponse)({ type: auth_response_dto_1.MessageResponseDto }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [auth_response_dto_1.ResetPasswordDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resetPassword", null);
__decorate([
    (0, common_1.Get)("scope-probe"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({
        summary: "Account-scope probe — 200 if JWT account_id matches query",
    }),
    (0, swagger_1.ApiQuery)({ name: "account_id", type: Number, required: true }),
    (0, swagger_1.ApiOkResponse)({ type: auth_response_dto_1.ScopeProbeResponseDto }),
    (0, swagger_1.ApiForbiddenResponse)({ description: "Account scope mismatch" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing or invalid token" }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("account_id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", auth_response_dto_1.ScopeProbeResponseDto)
], AuthController.prototype, "scopeProbe", null);
__decorate([
    (0, common_1.Get)("account-by-subdomain"),
    (0, swagger_1.ApiOperation)({
        summary: "Public SSO discovery by account subdomain",
    }),
    (0, swagger_1.ApiQuery)({ name: "subdomain", required: true }),
    (0, swagger_1.ApiOkResponse)({ type: auth_response_dto_1.AccountBySubdomainResponseDto }),
    (0, swagger_1.ApiNotFoundResponse)({ description: "Account not found" }),
    __param(0, (0, common_1.Query)("subdomain")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "accountBySubdomain", null);
__decorate([
    (0, common_1.Get)("google"),
    (0, swagger_1.ApiOperation)({ summary: "Start Google OAuth (Nest-owned SSO)" }),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "googleStart", null);
__decorate([
    (0, common_1.Get)("google/start"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("google")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "googleStartPassport", null);
__decorate([
    (0, common_1.Get)("google/callback"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("google")),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "googleCallback", null);
__decorate([
    (0, common_1.Get)("azure-ad"),
    (0, swagger_1.ApiOperation)({ summary: "Start Azure AD OAuth (Nest-owned SSO)" }),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "azureStart", null);
__decorate([
    (0, common_1.Get)("azure-ad/start"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("azure-ad")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "azureStartPassport", null);
__decorate([
    (0, common_1.Get)("azure-ad/callback"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("azure-ad")),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "azureCallback", null);
__decorate([
    (0, common_1.Get)("sso/simulate"),
    (0, swagger_1.ApiOperation)({
        summary: "Simulate SSO callback (AUTH_SSO_SIMULATE=1 only)",
    }),
    __param(0, (0, common_1.Query)("email")),
    __param(1, (0, common_1.Query)("provider")),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "simulateSso", null);
exports.AuthController = AuthController = __decorate([
    (0, swagger_1.ApiTags)("auth"),
    (0, common_1.Controller)("auth"),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        config_1.ConfigService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map