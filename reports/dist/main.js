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
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prom_client_1 = require("prom-client");
let ReportsMetrics = class ReportsMetrics {
    constructor() {
        this.register = new prom_client_1.Registry();
        (0, prom_client_1.collectDefaultMetrics)({
            register: this.register,
            prefix: "archaser_reports_",
        });
    }
    text() {
        return this.register.metrics();
    }
};
ReportsMetrics = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ReportsMetrics);
let ReportsController = class ReportsController {
    constructor(metrics) {
        this.metrics = metrics;
    }
    health() {
        return { status: "ok", service: "archaser-reports" };
    }
    async scrape(res) {
        res.send(await this.metrics.text());
    }
    execute(id, body) {
        return { id, status: "queued", body };
    }
    schedule(id, body) {
        return { id, scheduled: true, body };
    }
};
__decorate([
    (0, common_1.Get)("health"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "health", null);
__decorate([
    (0, common_1.Get)("metrics"),
    (0, common_1.Header)("Content-Type", "text/plain; version=0.0.4; charset=utf-8"),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "scrape", null);
__decorate([
    (0, common_1.Post)("internal/reports/:id/execute"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "execute", null);
__decorate([
    (0, common_1.Post)("internal/reports/:id/schedule"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "schedule", null);
ReportsController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [ReportsMetrics])
], ReportsController);
let ReportsModule = class ReportsModule {
};
ReportsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: [".env", "../../.env"],
            }),
        ],
        controllers: [ReportsController],
        providers: [ReportsMetrics],
    })
], ReportsModule);
async function bootstrap() {
    const app = await core_1.NestFactory.create(ReportsModule);
    const port = Number(process.env.REPORTS_PORT || 3006);
    await app.listen(port);
    if (typeof process.send === "function")
        process.send("ready");
}
bootstrap();
