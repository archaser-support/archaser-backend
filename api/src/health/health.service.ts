import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

export interface HealthResponse {
    status: "ok" | "degraded";
    service: string;
    database: {
        ok: boolean;
        userCount?: number;
        error?: string;
    };
}

@Injectable()
export class HealthService {
    constructor(private readonly database: DatabaseService) {}

    async getHealth(): Promise<HealthResponse> {
        try {
            const userCount = await this.database.user.count();
            return {
                status: "ok",
                service: "archaser-api",
                database: {
                    ok: true,
                    userCount,
                },
            };
        } catch (error) {
            return {
                status: "degraded",
                service: "archaser-api",
                database: {
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "database unavailable",
                },
            };
        }
    }
}
