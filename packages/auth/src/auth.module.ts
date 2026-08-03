import { DynamicModule, Module, Type } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AUTH_DATABASE } from "./auth-database";
import { AccessScopeService } from "./access-scope.service";
import { CronSecretGuard } from "./cron-secret.guard";
import { DualAuthGuard } from "./dual-auth.guard";
import { InternalSecretGuard } from "./internal-secret.guard";
import { InternalServiceClient } from "./internal-service.client";
import { SoftDualAuthGuard } from "./soft-dual-auth.guard";

export type ArchaserAuthModuleOptions = {
    /** App DatabaseModule (must export DatabaseService). */
    imports: Array<Type<unknown> | DynamicModule>;
    /** Existing DatabaseService class (extends PrismaClient). */
    useExisting: Type<unknown>;
};

/**
 * Shared auth for Nest peels (sms, connectors, reports) and main api.
 * Caller must provide AUTH_DATABASE via useExisting DatabaseService.
 */
@Module({})
export class ArchaserAuthModule {
    static forRoot(options: ArchaserAuthModuleOptions): DynamicModule {
        return {
            module: ArchaserAuthModule,
            imports: [
                ...options.imports,
                ConfigModule,
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
            providers: [
                {
                    provide: AUTH_DATABASE,
                    useExisting: options.useExisting,
                },
                AccessScopeService,
                DualAuthGuard,
                SoftDualAuthGuard,
                CronSecretGuard,
                InternalSecretGuard,
                InternalServiceClient,
            ],
            exports: [
                AccessScopeService,
                DualAuthGuard,
                SoftDualAuthGuard,
                CronSecretGuard,
                InternalSecretGuard,
                InternalServiceClient,
                JwtModule,
            ],
        };
    }
}
