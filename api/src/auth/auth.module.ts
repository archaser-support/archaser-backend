import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { DatabaseModule } from "../database/database.module";
import { EmailModule } from "../email/email.module";
import { AccessScopeService } from "./access-scope.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AzureAdStrategy } from "./azure-ad.strategy";
import { CronSecretGuard } from "./cron-secret.guard";
import { DualAuthGuard } from "./dual-auth.guard";
import { GoogleStrategy } from "./google.strategy";
import { JwtStrategy } from "./jwt.strategy";
import { SoftDualAuthGuard } from "./soft-dual-auth.guard";

@Module({
    imports: [
        DatabaseModule,
        EmailModule,
        PassportModule.register({ defaultStrategy: "jwt" }),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const expiresIn =
                    configService.get<string>("JWT_EXPIRES_IN") || "8h";
                return {
                    secret:
                        configService.get<string>("JWT_SECRET") ||
                        configService.get<string>("NEXTAUTH_SECRET") ||
                        "archaser-stage0-dev-secret",
                    signOptions: {
                        expiresIn: expiresIn as `${number}h`,
                    },
                };
            },
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        AccessScopeService,
        JwtStrategy,
        GoogleStrategy,
        AzureAdStrategy,
        DualAuthGuard,
        SoftDualAuthGuard,
        CronSecretGuard,
    ],
    exports: [
        AuthService,
        AccessScopeService,
        JwtModule,
        DualAuthGuard,
        SoftDualAuthGuard,
        CronSecretGuard,
        EmailModule,
    ],
})
export class AuthModule {}
