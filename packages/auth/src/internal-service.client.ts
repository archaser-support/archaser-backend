import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Service-to-service HTTP client (D32–D34, D51–D52 temporary home in api;
 * will move into @archaser/auth during SMS soak).
 */
@Injectable()
export class InternalServiceClient {
    private readonly logger = new Logger(InternalServiceClient.name);

    constructor(private readonly config: ConfigService) {}

    private secret(): string {
        return (
            this.config.get<string>("INTERNAL_SERVICE_SECRET") ||
            process.env.INTERNAL_SERVICE_SECRET ||
            ""
        );
    }

    async post(
        service: "sms" | "connectors" | "reports",
        path: string,
        body: unknown = {}
    ): Promise<{ status: number; body: unknown }> {
        const map = {
            sms: this.config.get<string>("SMS_SERVICE_URL"),
            connectors: this.config.get<string>("CONNECTORS_SERVICE_URL"),
            reports: this.config.get<string>("REPORTS_SERVICE_URL"),
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
            let parsed: unknown = text;
            try {
                parsed = text ? JSON.parse(text) : null;
            } catch {
                // keep text
            }
            return { status: response.status, body: parsed };
        } catch (error) {
            this.logger.error(
                `Internal call to ${service} failed: ${
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
