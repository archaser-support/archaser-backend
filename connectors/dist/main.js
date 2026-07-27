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
let ConnectorsController = class ConnectorsController {
    constructor(metrics) {
        this.metrics = metrics;
    }
    health() {
        return { status: "ok", service: "archaser-connectors" };
    }
    async scrape(res) {
        res.send(await this.metrics.text());
    }
    mappings(accountId) {
        return { accountId, mappings: [] };
    }
    sync(accountId, body) {
        return { accountId, enqueued: true, body };
    }
};
__decorate([
    (0, common_1.Get)("health"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ConnectorsController.prototype, "health", null);
__decorate([
    (0, common_1.Get)("metrics"),
    (0, common_1.Header)("Content-Type", "text/plain; version=0.0.4; charset=utf-8"),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ConnectorsController.prototype, "scrape", null);
__decorate([
    (0, common_1.Get)("internal/accounts/:accountId/mappings"),
    __param(0, (0, common_1.Param)("accountId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ConnectorsController.prototype, "mappings", null);
__decorate([
    (0, common_1.Post)("internal/accounts/:accountId/sync"),
    __param(0, (0, common_1.Param)("accountId")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ConnectorsController.prototype, "sync", null);
ConnectorsController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [ConnectorsMetrics])
], ConnectorsController);
let ConnectorsModule = class ConnectorsModule {
};
ConnectorsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: [".env", "../../.env"],
            }),
        ],
        controllers: [ConnectorsController],
        providers: [ConnectorsMetrics],
    })
], ConnectorsModule);
async function bootstrap() {
    const app = await core_1.NestFactory.create(ConnectorsModule);
    const port = Number(process.env.CONNECTORS_PORT || 3005);
    await app.listen(port);
    if (typeof process.send === "function")
        process.send("ready");
}
bootstrap();
