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
export declare class HealthService {
    private readonly database;
    constructor(database: DatabaseService);
    getHealth(): Promise<HealthResponse>;
}
