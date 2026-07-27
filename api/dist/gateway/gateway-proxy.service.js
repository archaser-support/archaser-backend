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
var GatewayProxyService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayProxyService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let GatewayProxyService = GatewayProxyService_1 = class GatewayProxyService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(GatewayProxyService_1.name);
    }
    base(service) {
        const map = {
            sms: this.config.get("SMS_SERVICE_URL"),
            connectors: this.config.get("CONNECTORS_SERVICE_URL"),
            reports: this.config.get("REPORTS_SERVICE_URL"),
        };
        return map[service] || null;
    }
    async forward(service, path, init = {}) {
        const base = this.base(service);
        if (!base) {
            return {
                status: 503,
                body: {
                    error: `${service} service URL not configured`,
                    hint: `Set ${service.toUpperCase()}_SERVICE_URL`,
                },
            };
        }
        const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
        try {
            const response = await fetch(url, {
                ...init,
                headers: {
                    "Content-Type": "application/json",
                    ...(init.headers || {}),
                },
            });
            const text = await response.text();
            let body = text;
            try {
                body = text ? JSON.parse(text) : null;
            }
            catch {
            }
            return { status: response.status, body };
        }
        catch (error) {
            this.logger.error(`Gateway proxy to ${service} failed: ${error instanceof Error ? error.message : String(error)}`);
            return {
                status: 502,
                body: { error: `${service} service unreachable` },
            };
        }
    }
};
exports.GatewayProxyService = GatewayProxyService;
exports.GatewayProxyService = GatewayProxyService = GatewayProxyService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GatewayProxyService);
//# sourceMappingURL=gateway-proxy.service.js.map