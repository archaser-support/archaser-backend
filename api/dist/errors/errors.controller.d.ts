import { Request } from "express";
import { DatabaseService } from "../database/database.service";
export declare class ErrorsController {
    private readonly db;
    constructor(db: DatabaseService);
    report(body: Record<string, unknown>, userAgentHeader?: string, refererHeader?: string, req?: Request): Promise<{
        success: boolean;
        received: boolean;
        timestamp: string;
    }>;
}
