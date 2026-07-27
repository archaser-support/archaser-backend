import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { JwtPayload } from "./auth.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(configService: ConfigService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey:
                configService.get<string>("JWT_SECRET") ||
                configService.get<string>("NEXTAUTH_SECRET") ||
                "archaser-stage0-dev-secret",
        });
    }

    validate(payload: JwtPayload): JwtPayload {
        return {
            sub: payload.sub,
            username: payload.username,
            email: payload.email ?? null,
            account_id: payload.account_id ?? null,
            role: payload.role ?? null,
            name: payload.name ?? null,
        };
    }
}
