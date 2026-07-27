import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, VerifyCallback } from "passport-oauth2";
import { AuthService } from "./auth.service";

type AzureIdTokenClaims = {
    email?: string;
    preferred_username?: string;
    upn?: string;
    mail?: string;
    oid?: string;
    sub?: string;
    name?: string;
};

/**
 * Azure AD OAuth2 (v2 endpoint) with email fallbacks matching NextAuth profile().
 */
@Injectable()
export class AzureAdStrategy extends PassportStrategy(Strategy, "azure-ad") {
    constructor(
        configService: ConfigService,
        private readonly authService: AuthService
    ) {
        const clientID =
            configService.get<string>("MICROSOFT_CLIENT_ID") ||
            configService.get<string>("NEXT_PUBLIC_MICROSOFT_CLIENT_ID") ||
            "unused-ms-client-id";
        const clientSecret =
            configService.get<string>("MICROSOFT_CLIENT_SECRET") ||
            configService.get<string>("NEXT_PUBLIC_MICROSOFT_CLIENT_SECRET") ||
            "unused-ms-client-secret";
        const tenant =
            configService.get<string>("MICROSOFT_TENANT_ID") || "common";
        const base = (
            configService.get<string>("NEST_PUBLIC_URL") ||
            "http://localhost:3002"
        ).replace(/\/$/, "");

        super({
            authorizationURL: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
            tokenURL: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
            clientID,
            clientSecret,
            callbackURL: `${base}/auth/azure-ad/callback`,
            scope: ["openid", "profile", "email", "User.Read"],
        });
    }

    validate(
        accessToken: string,
        _refreshToken: string,
        params: { id_token?: string },
        done: VerifyCallback
    ): void {
        void accessToken;
        let email = "";

        if (params?.id_token) {
            try {
                const payload = JSON.parse(
                    Buffer.from(
                        params.id_token.split(".")[1],
                        "base64"
                    ).toString("utf8")
                ) as AzureIdTokenClaims;
                email =
                    payload.email ||
                    payload.preferred_username ||
                    payload.upn ||
                    payload.mail ||
                    "";
            } catch {
                email = "";
            }
        }

        done(null, {
            email: this.authService.normalizeEmail(email),
            provider: "microsoft",
        });
    }
}
