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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpMetricsMiddleware = void 0;
const common_1 = require("@nestjs/common");
const metrics_service_1 = require("./metrics.service");
let HttpMetricsMiddleware = class HttpMetricsMiddleware {
    constructor(metricsService) {
        this.metricsService = metricsService;
    }
    use(req, res, next) {
        if (req.path === "/metrics" || req.path === "/health") {
            next();
            return;
        }
        const start = process.hrtime.bigint();
        const route = req.route?.path
            ? `${req.baseUrl || ""}${req.route.path}`
            : req.path;
        res.on("finish", () => {
            const elapsedNs = Number(process.hrtime.bigint() - start);
            const seconds = elapsedNs / 1e9;
            const labels = {
                method: req.method,
                route,
                status_code: String(res.statusCode),
            };
            this.metricsService.httpRequestCounter.inc(labels);
            this.metricsService.httpRequestDuration.observe(labels, seconds);
        });
        next();
    }
};
exports.HttpMetricsMiddleware = HttpMetricsMiddleware;
exports.HttpMetricsMiddleware = HttpMetricsMiddleware = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [metrics_service_1.MetricsService])
], HttpMetricsMiddleware);
//# sourceMappingURL=http-metrics.middleware.js.map