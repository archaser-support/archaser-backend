import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Forwards selected domains to peeled Nest services.
 * Browser continues to call only the main API base URL.
 */
@Injectable()
export class GatewayProxyService {
    private readonly logger = new Logger(GatewayProxyService.name);

    constructor(private readonly config: ConfigService) {}

    private base(service: "sms" | "connectors" | "reports"): string | null {
        const map = {
            sms: this.config.get<string>("SMS_SERVICE_URL"),
            connectors: this.config.get<string>("CONNECTORS_SERVICE_URL"),
            reports: this.config.get<string>("REPORTS_SERVICE_URL"),
        };
        return map[service] || null;
    }

    async forward(
        service: "sms" | "connectors" | "reports",
        path: string,
        init: RequestInit = {}
    ): Promise<{ status: number; body: unknown }> {
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
            let body: unknown = text;
            try {
                body = text ? JSON.parse(text) : null;
            } catch {
                // keep text
            }
            return { status: response.status, body };
        } catch (error) {
            this.logger.error(
                `Gateway proxy to ${service} failed: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return {
                status: 502,
                body: { error: `${service} service unreachable` },
            };
        }
    }
}
