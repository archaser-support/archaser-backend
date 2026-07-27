import { ConfigService } from "@nestjs/config";
export declare class GatewayProxyService {
    private readonly config;
    private readonly logger;
    constructor(config: ConfigService);
    private base;
    forward(service: "sms" | "connectors" | "reports", path: string, init?: RequestInit): Promise<{
        status: number;
        body: unknown;
    }>;
}
