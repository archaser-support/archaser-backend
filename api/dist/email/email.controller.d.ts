import { Response } from "express";
import { DatabaseService } from "../database/database.service";
export declare class EmailController {
    private readonly db;
    constructor(db: DatabaseService);
    trackOpen(messageId: string, res: Response): Promise<void>;
    trackClick(messageId: string, url?: string): Promise<{
        url: string;
    }>;
    sesWebhook(body: Record<string, unknown>): Promise<{
        success: boolean;
        confirmed: boolean;
    } | {
        success: boolean;
        confirmed?: undefined;
    }>;
}
