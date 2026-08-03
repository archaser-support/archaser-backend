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
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prom_client_1 = require("prom-client");
const auth_module_1 = require("./auth/auth.module");
const database_module_1 = require("./database/database.module");
const internal_sms_controller_1 = require("./internal/internal-sms.controller");
const sms_module_1 = require("./sms/sms.module");
let SmsMetrics = class SmsMetrics {
    constructor() {
        this.register = new prom_client_1.Registry();
        (0, prom_client_1.collectDefaultMetrics)({
            register: this.register,
            prefix: "archaser_sms_",
        });
    }
    text() {
        return this.register.metrics();
    }
};
SmsMetrics = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], SmsMetrics);
let HealthController = class HealthController {
    constructor(metrics) {
        this.metrics = metrics;
    }
    health() {
        return { status: "ok", service: "archaser-sms" };
    }
    async scrape(res) {
        res.send(await this.metrics.text());
    }
};
__decorate([
    (0, common_1.Get)("health"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "health", null);
__decorate([
    (0, common_1.Get)("metrics"),
    (0, common_1.Header)("Content-Type", "text/plain; version=0.0.4; charset=utf-8"),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "scrape", null);
HealthController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [SmsMetrics])
], HealthController);
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: [".env", "../.env"],
            }),
            database_module_1.DatabaseModule,
            auth_module_1.AuthModule,
            sms_module_1.SmsDomainModule,
        ],
        controllers: [HealthController, internal_sms_controller_1.InternalSmsController],
        providers: [SmsMetrics],
    })
], AppModule);
