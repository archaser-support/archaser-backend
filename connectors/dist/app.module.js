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
const billing_connector_1 = require("@archaser/billing-connector");
const cron_jobs_1 = require("@archaser/cron-jobs");
const prom_client_1 = require("prom-client");
const auth_module_1 = require("./auth/auth.module");
const database_module_1 = require("./database/database.module");
const accounts_module_1 = require("./accounts/accounts.module");
const internal_connectors_controller_1 = require("./internal/internal-connectors.controller");
const sync_module_1 = require("./sync/sync.module");
let ConnectorsMetrics = class ConnectorsMetrics {
    constructor() {
        this.register = new prom_client_1.Registry();
        (0, prom_client_1.collectDefaultMetrics)({
            register: this.register,
            prefix: "archaser_connectors_",
        });
    }
    text() {
        return this.register.metrics();
    }
};
ConnectorsMetrics = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ConnectorsMetrics);
let HealthController = class HealthController {
    constructor(metrics) {
        this.metrics = metrics;
    }
    health() {
        return { status: "ok", service: "archaser-connectors" };
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
    __metadata("design:paramtypes", [ConnectorsMetrics])
], HealthController);
let AppModule = class AppModule {
    /**
     * Connector syncs triggered here (queue worker, nested account sync,
     * internal inline sync) pass no `onArPostIngest`, so they fall back to
     * `runArPostIngestViaHost`, which calls the registered orchestrator.
     * Without this the fallback would log "orchestrator is not registered"
     * and post-ingest AR refresh would silently stop in this process.
     */
    onModuleInit() {
        (0, billing_connector_1.registerArPostIngestOrchestrator)((options) => (0, cron_jobs_1.runArPostIngestForCustomers)(options));
    }
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
            accounts_module_1.AccountsDomainModule,
            sync_module_1.SyncModule,
        ],
        controllers: [HealthController, internal_connectors_controller_1.InternalConnectorsController],
        providers: [ConnectorsMetrics],
    })
], AppModule);
