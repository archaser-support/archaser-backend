import { DatabaseService } from "../database/database.service";
export declare class PlatformLeavesController {
    private readonly db;
    constructor(db: DatabaseService);
    alertDetails(apiKey: string | undefined, type: string, limitRaw?: string): Promise<{
        type: "automation_stuck_no_contacts";
        count: number;
        details: {
            period_id: number;
            customer_id: string;
            customer_email: string;
            category: import(".prisma/client").$Enums.category | null;
            outstanding_amount: number | null;
            period_start: Date;
        }[];
    } | {
        type: "cron_jobs_overdue" | "cron_jobs_not_run_24h";
        count: number;
        details: {
            id: number;
            name: string;
            last_run_at: Date | null;
            next_run_at: Date | null;
        }[];
    } | {
        type: "stuck_activities";
        count: number;
        details: {
            id: bigint;
            type: import(".prisma/client").$Enums.activity_type;
            status: import(".prisma/client").$Enums.activity_status;
            customer_id: number;
            schedule_time: Date;
        }[];
    } | {
        type: string;
        count: number;
        details: never[];
        message: string;
    }>;
    contactResponse(body: Record<string, unknown>): Promise<{
        error: string;
        success?: undefined;
        message?: undefined;
        data?: undefined;
    } | {
        success: boolean;
        message: string;
        data: {
            activityId: number;
            contactId: number;
            channel: {};
            timestamp: string;
        };
        error?: undefined;
    }>;
}
