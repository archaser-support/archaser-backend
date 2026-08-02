import { DatabaseService } from "../database/database.service";
export declare class CommunicationIntelligenceController {
    private readonly db;
    constructor(db: DatabaseService);
    channelSelection(body: Record<string, unknown>): Promise<{
        error: string;
        enabled?: undefined;
        selectedChannel?: undefined;
        reason?: undefined;
        alternatives?: undefined;
        activityId?: undefined;
        customerId?: undefined;
    } | {
        error: string;
        enabled: boolean;
        selectedChannel?: undefined;
        reason?: undefined;
        alternatives?: undefined;
        activityId?: undefined;
        customerId?: undefined;
    } | {
        enabled: boolean;
        selectedChannel: import(".prisma/client").$Enums.activity_type;
        reason: string;
        alternatives: string[];
        activityId: number;
        customerId: number;
        error?: undefined;
    }>;
    learningData(accountIdRaw?: string, limitRaw?: string): Promise<{
        samples: {
            predicted_success_rate: number | null;
            id: number;
            status: import(".prisma/client").$Enums.delivery_status | null;
            delivered_at: Date | null;
            failed_at: Date | null;
            communication_channel: import(".prisma/client").$Enums.activity_type | null;
            channel_selection_reason: string | null;
        }[];
        total: number;
    }>;
    analytics(customerIdRaw?: string, channel?: string, startDateRaw?: string, endDateRaw?: string, query?: string): Promise<{
        channelMetrics: {
            channel: string;
            totalAttempts: number;
            totalSuccesses: number;
            successRate: number;
            averageResponseTime: number | null;
        }[];
        totalRecords: number;
        period: {
            startDate: string | null;
            endDate: string | null;
        };
        generatedAt: string;
    }>;
}
