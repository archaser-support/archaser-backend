"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const database_module_1 = require("../database/database.module");
const email_module_1 = require("../email/email.module");
const access_scope_service_1 = require("./access-scope.service");
const auth_controller_1 = require("./auth.controller");
const auth_service_1 = require("./auth.service");
const azure_ad_strategy_1 = require("./azure-ad.strategy");
const cron_secret_guard_1 = require("./cron-secret.guard");
const dual_auth_guard_1 = require("./dual-auth.guard");
const google_strategy_1 = require("./google.strategy");
const jwt_strategy_1 = require("./jwt.strategy");
const soft_dual_auth_guard_1 = require("./soft-dual-auth.guard");
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            database_module_1.DatabaseModule,
            email_module_1.EmailModule,
            passport_1.PassportModule.register({ defaultStrategy: "jwt" }),
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
        controllers: [auth_controller_1.AuthController],
        providers: [
            auth_service_1.AuthService,
            access_scope_service_1.AccessScopeService,
            jwt_strategy_1.JwtStrategy,
            google_strategy_1.GoogleStrategy,
            azure_ad_strategy_1.AzureAdStrategy,
            dual_auth_guard_1.DualAuthGuard,
            soft_dual_auth_guard_1.SoftDualAuthGuard,
            cron_secret_guard_1.CronSecretGuard,
        ],
        exports: [
            auth_service_1.AuthService,
            access_scope_service_1.AccessScopeService,
            jwt_1.JwtModule,
            dual_auth_guard_1.DualAuthGuard,
            soft_dual_auth_guard_1.SoftDualAuthGuard,
            cron_secret_guard_1.CronSecretGuard,
            email_module_1.EmailModule,
        ],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map