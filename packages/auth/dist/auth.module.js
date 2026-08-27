"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ArchaserAuthModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArchaserAuthModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const auth_database_1 = require("./auth-database");
const access_scope_service_1 = require("./access-scope.service");
const dual_auth_guard_1 = require("./dual-auth.guard");
const internal_secret_guard_1 = require("./internal-secret.guard");
const internal_service_client_1 = require("./internal-service.client");
const soft_dual_auth_guard_1 = require("./soft-dual-auth.guard");
/**
 * Shared auth for Nest peels (sms, connectors, reports) and main api.
 * Caller must provide AUTH_DATABASE via useExisting DatabaseService.
 */
let ArchaserAuthModule = ArchaserAuthModule_1 = class ArchaserAuthModule {
    static forRoot(options) {
        return {
            module: ArchaserAuthModule_1,
            imports: [
                ...options.imports,
                config_1.ConfigModule,
                jwt_1.JwtModule.registerAsync({
                    imports: [config_1.ConfigModule],
                    inject: [config_1.ConfigService],
                    useFactory: (configService) => {
                        const expiresIn = configService.get("JWT_EXPIRES_IN") || "8h";
                        return {
                            secret: configService.get("JWT_SECRET") ||
                                configService.get("NEXTAUTH_SECRET") ||
                                "archaser-stage0-dev-secret",
                            signOptions: {
                                expiresIn: expiresIn,
                            },
                        };
                    },
                }),
            ],
            providers: [
                {
                    provide: auth_database_1.AUTH_DATABASE,
                    useExisting: options.useExisting,
                },
                access_scope_service_1.AccessScopeService,
                dual_auth_guard_1.DualAuthGuard,
                soft_dual_auth_guard_1.SoftDualAuthGuard,
                internal_secret_guard_1.InternalSecretGuard,
                internal_service_client_1.InternalServiceClient,
            ],
            exports: [
                access_scope_service_1.AccessScopeService,
                dual_auth_guard_1.DualAuthGuard,
                soft_dual_auth_guard_1.SoftDualAuthGuard,
                internal_secret_guard_1.InternalSecretGuard,
                internal_service_client_1.InternalServiceClient,
                jwt_1.JwtModule,
            ],
        };
    }
};
exports.ArchaserAuthModule = ArchaserAuthModule;
exports.ArchaserAuthModule = ArchaserAuthModule = ArchaserAuthModule_1 = __decorate([
    (0, common_1.Module)({})
], ArchaserAuthModule);
