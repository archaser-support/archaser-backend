import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, Profile, VerifyCallback } from "passport-google-oauth20";
import { AuthService } from "./auth.service";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
    constructor(
        configService: ConfigService,
        private readonly authService: AuthService
    ) {
        const clientID =
            configService.get<string>("GOOGLE_CLIENT_ID") ||
            configService.get<string>("NEXT_PUBLIC_GOOGLE_CLIENT_ID") ||
            "unused-google-client-id";
        const clientSecret =
            configService.get<string>("GOOGLE_CLIENT_SECRET") ||
            configService.get<string>("NEXT_PUBLIC_GOOGLE_CLIENT_SECRET") ||
            "unused-google-client-secret";
        const callbackURL = `${(
            configService.get<string>("NEST_PUBLIC_URL") ||
            "http://localhost:3002"
        ).replace(/\/$/, "")}/auth/google/callback`;

        super({
            clientID,
            clientSecret,
            callbackURL,
            scope: ["email", "profile"],
        });
    }

    validate(
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: VerifyCallback
    ): void {
        const email =
            profile.emails?.[0]?.value ||
            (profile as { email?: string }).email ||
            null;
        done(null, {
            email: this.authService.normalizeEmail(email),
            provider: "google",
        });
    }
}
