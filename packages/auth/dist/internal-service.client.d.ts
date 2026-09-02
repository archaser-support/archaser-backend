import { ConfigService } from "@nestjs/config";
/**
 * Service-to-service HTTP client (D32–D34, D51–D52 temporary home in api;
 * will move into @archaser/auth during SMS soak).
 */
export declare class InternalServiceClient {
    private readonly config;
    private readonly logger;
    constructor(config: ConfigService);
    private secret;
    post(service: "sms" | "connectors" | "reports", path: string, body?: unknown): Promise<{
        status: number;
        body: unknown;
    }>;
}
