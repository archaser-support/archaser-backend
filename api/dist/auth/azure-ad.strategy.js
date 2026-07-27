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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureAdStrategy = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const passport_1 = require("@nestjs/passport");
const passport_oauth2_1 = require("passport-oauth2");
const auth_service_1 = require("./auth.service");
let AzureAdStrategy = class AzureAdStrategy extends (0, passport_1.PassportStrategy)(passport_oauth2_1.Strategy, "azure-ad") {
    constructor(configService, authService) {
        const clientID = configService.get("MICROSOFT_CLIENT_ID") ||
            configService.get("NEXT_PUBLIC_MICROSOFT_CLIENT_ID") ||
            "unused-ms-client-id";
        const clientSecret = configService.get("MICROSOFT_CLIENT_SECRET") ||
            configService.get("NEXT_PUBLIC_MICROSOFT_CLIENT_SECRET") ||
            "unused-ms-client-secret";
        const tenant = configService.get("MICROSOFT_TENANT_ID") || "common";
        const base = (configService.get("NEST_PUBLIC_URL") ||
            "http://localhost:3002").replace(/\/$/, "");
        super({
            authorizationURL: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
            tokenURL: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
            clientID,
            clientSecret,
            callbackURL: `${base}/auth/azure-ad/callback`,
            scope: ["openid", "profile", "email", "User.Read"],
        });
        this.authService = authService;
    }
    validate(accessToken, _refreshToken, params, done) {
        void accessToken;
        let email = "";
        if (params?.id_token) {
            try {
                const payload = JSON.parse(Buffer.from(params.id_token.split(".")[1], "base64").toString("utf8"));
                email =
                    payload.email ||
                        payload.preferred_username ||
                        payload.upn ||
                        payload.mail ||
                        "";
            }
            catch {
                email = "";
            }
        }
        done(null, {
            email: this.authService.normalizeEmail(email),
            provider: "microsoft",
        });
    }
};
exports.AzureAdStrategy = AzureAdStrategy;
exports.AzureAdStrategy = AzureAdStrategy = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        auth_service_1.AuthService])
], AzureAdStrategy);
//# sourceMappingURL=azure-ad.strategy.js.map