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
exports.LokiTransportService = void 0;
const common_1 = require("@nestjs/common");
let LokiTransportService = class LokiTransportService {
    constructor() {
        this.lokiUrl = process.env.LOKI_HOST || "http://localhost:3100";
        this.enabled = process.env.ENABLE_LOKI_LOGGING === "true";
        this.serviceName = process.env.SERVICE_NAME || "archaser-api";
        this.environment = process.env.NODE_ENV || "development";
    }
    async sendLog(logData) {
        if (!this.enabled)
            return;
        void this.pushToLoki(logData).catch(() => {
        });
    }
    async pushToLoki(logData) {
        const timestampNs = (logData.timestamp || new Date()).getTime() * 1_000_000;
        const payload = {
            streams: [
                {
                    stream: {
                        service: this.serviceName,
                        environment: this.environment,
                        level: logData.level,
                        source: logData.source,
                        customer_id: logData.account_id
                            ? String(logData.account_id)
                            : "system",
                    },
                    values: [
                        [
                            String(timestampNs),
                            JSON.stringify({
                                message: logData.message,
                                details: logData.details,
                                correlation_id: logData.correlation_id,
                                user_id: logData.user_id,
                                job_id: logData.job_id,
                                sub_source: logData.sub_source,
                            }),
                        ],
                    ],
                },
            ],
        };
        const response = await fetch(`${this.lokiUrl}/loki/api/v1/push`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(1000),
        });
        if (!response.ok) {
            throw new Error(`Loki push failed: ${response.status}`);
        }
    }
};
exports.LokiTransportService = LokiTransportService;
exports.LokiTransportService = LokiTransportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], LokiTransportService);
//# sourceMappingURL=loki-transport.service.js.map