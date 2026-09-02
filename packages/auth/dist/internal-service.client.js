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
var InternalServiceClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalServiceClient = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
/**
 * Service-to-service HTTP client (D32–D34, D51–D52 temporary home in api;
 * will move into @archaser/auth during SMS soak).
 */
let InternalServiceClient = InternalServiceClient_1 = class InternalServiceClient {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(InternalServiceClient_1.name);
    }
    secret() {
        return (this.config.get("INTERNAL_SERVICE_SECRET") ||
            process.env.INTERNAL_SERVICE_SECRET ||
            "");
    }
    async post(service, path, body = {}) {
        const map = {
            sms: this.config.get("SMS_SERVICE_URL"),
            connectors: this.config.get("CONNECTORS_SERVICE_URL"),
            reports: this.config.get("REPORTS_SERVICE_URL"),
        };
        const base = map[service];
        if (!base) {
            return {
                status: 503,
                body: {
                    error: `${service} service URL not configured`,
                    hint: `Set ${service.toUpperCase()}_SERVICE_URL`,
                },
            };
        }
        const secret = this.secret();
        if (!secret) {
            return {
                status: 503,
                body: { error: "INTERNAL_SERVICE_SECRET is not configured" },
            };
        }
        const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-internal-service-secret": secret,
                },
                body: JSON.stringify(body ?? {}),
            });
            const text = await response.text();
            let parsed = text;
            try {
                parsed = text ? JSON.parse(text) : null;
            }
            catch {
                // keep text
            }
            return { status: response.status, body: parsed };
        }
        catch (error) {
            this.logger.error(`Internal call to ${service} failed: ${error instanceof Error ? error.message : String(error)}`);
            return {
                status: 502,
                body: { error: `${service} service unreachable` },
            };
        }
    }
};
exports.InternalServiceClient = InternalServiceClient;
exports.InternalServiceClient = InternalServiceClient = InternalServiceClient_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], InternalServiceClient);
