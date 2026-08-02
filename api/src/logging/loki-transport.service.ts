import { Injectable } from "@nestjs/common";
import { CreateLogData } from "./mongo-log.types";

/**
 * Fire-and-forget Loki push (staging LokiTransportService parity).
 * Uses fetch so Nest does not need axios.
 */
@Injectable()
export class LokiTransportService {
    private readonly lokiUrl: string;
    private readonly enabled: boolean;
    private readonly serviceName: string;
    private readonly environment: string;

    constructor() {
        this.lokiUrl = process.env.LOKI_HOST || "http://localhost:3100";
        this.enabled = process.env.ENABLE_LOKI_LOGGING === "true";
        this.serviceName = process.env.SERVICE_NAME || "archaser-api";
        this.environment = process.env.NODE_ENV || "development";
    }

    async sendLog(logData: CreateLogData): Promise<void> {
        if (!this.enabled) return;
        void this.pushToLoki(logData).catch(() => {
            /* never block callers */
        });
    }

    private async pushToLoki(logData: CreateLogData): Promise<void> {
        const timestampNs =
            (logData.timestamp || new Date()).getTime() * 1_000_000;
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
}
