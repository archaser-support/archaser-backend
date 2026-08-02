import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
import { RealtimeHubService } from "../realtime/realtime-hub.service";
export type OperationsListQuery = {
    page?: string;
    limit?: string;
    status?: string;
    customer_id?: string;
    stats?: string;
    type?: string;
    priority?: string;
};
export declare class OperationsService {
    private readonly db;
    private readonly accessScope;
    private readonly realtime;
    constructor(db: DatabaseService, accessScope: AccessScopeService, realtime: RealtimeHubService);
    list(operationType: string, user: JwtPayload, query: OperationsListQuery): Promise<{
        disputes: ({
            DisputeReason: {
                account_id: number | null;
                name: string;
                id: number;
                created_at: Date;
                modified_at: Date;
                status: import(".prisma/client").$Enums.record_status;
                created_by: string | null;
                modified_by: string | null;
                master_template: boolean;
                editable: boolean | null;
            } | null;
            Customer: {
                id: number;
                customer_number: string | null;
            };
        } & {
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            owner_id: string | null;
            dispute_resolution: import(".prisma/client").$Enums.dispute_resolution | null;
            customer_id: number;
            dispute_reason_id: number | null;
            dispute_status: import(".prisma/client").$Enums.dispute_status | null;
            customer_comment: string | null;
            customer_collection_period_id: number | null;
            resolution_comment: string | null;
            invoices_in_dispute: string | null;
            contact_first_name: string | null;
            contact_last_name: string | null;
            contact_email: string | null;
            contact_mobile: string | null;
            closed_at: Date | null;
        })[];
        totalRecords: number;
        page: number;
        limit: number;
    } | {
        disputeReasons: {
            account_id: number | null;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
            created_by: string | null;
            modified_by: string | null;
            master_template: boolean;
            editable: boolean | null;
        }[];
        totalRecords: number;
        page: number;
        limit: number;
    } | {
        total: number;
        unread: number;
        byType: {
            controlCenter: number;
            disputes: number;
            invoices: number;
            activities: number;
            assignments: number;
            overdue: number;
            payments: number;
            system: number;
        };
        byPriority: {
            low: number;
            medium: number;
            high: number;
            urgent: number;
        };
    } | {
        notifications: {
            id: string;
            type: import(".prisma/client").$Enums.notification_type;
            title: string;
            message: string;
            priority: import(".prisma/client").$Enums.priority;
            timestamp: Date;
            actionUrl: string | null;
            metadata: import("@prisma/client/runtime/library").JsonValue;
            userId: string;
            accountId: number;
            read: boolean;
        }[];
        total: number;
        page: number;
        limit: number;
    } | {
        [x: string]: number | never[];
        totalRecords: number;
    }>;
    getById(operationType: string, user: JwtPayload, id: string): Promise<{
        account_id: number | null;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.record_status;
        created_by: string | null;
        modified_by: string | null;
        master_template: boolean;
        editable: boolean | null;
    } | {
        stats: {
            counts: {
                total: number;
                open: number;
                resolved: number;
                inProgress: number;
            };
            currency: string;
            pieChartData: {
                name: string;
                value: number;
            }[];
            disputeAssignFrequencyList: never[];
        };
    } | {
        legalCases: never[];
        totalRecords: number;
        currentPage: number;
        totalPages: number;
        currency: string;
        totalAmount: number;
        totalCustomers: number;
    } | ({
        DisputeReason: {
            account_id: number | null;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
            created_by: string | null;
            modified_by: string | null;
            master_template: boolean;
            editable: boolean | null;
        } | null;
        DisputeInvoice: {
            id: number;
            created_at: Date | null;
            modified_at: Date | null;
            created_by: string | null;
            modified_by: string | null;
            invoice_id: number;
            dispute_id: number;
        }[];
    } & {
        id: number;
        created_at: Date;
        modified_at: Date;
        created_by: string | null;
        modified_by: string | null;
        owner_id: string | null;
        dispute_resolution: import(".prisma/client").$Enums.dispute_resolution | null;
        customer_id: number;
        dispute_reason_id: number | null;
        dispute_status: import(".prisma/client").$Enums.dispute_status | null;
        customer_comment: string | null;
        customer_collection_period_id: number | null;
        resolution_comment: string | null;
        invoices_in_dispute: string | null;
        contact_first_name: string | null;
        contact_last_name: string | null;
        contact_email: string | null;
        contact_mobile: string | null;
        closed_at: Date | null;
    })>;
    update(operationType: string, user: JwtPayload, id: string, body: Record<string, unknown>): Promise<{
        id: number;
        created_at: Date;
        modified_at: Date;
        created_by: string | null;
        modified_by: string | null;
        owner_id: string | null;
        dispute_resolution: import(".prisma/client").$Enums.dispute_resolution | null;
        customer_id: number;
        dispute_reason_id: number | null;
        dispute_status: import(".prisma/client").$Enums.dispute_status | null;
        customer_comment: string | null;
        customer_collection_period_id: number | null;
        resolution_comment: string | null;
        invoices_in_dispute: string | null;
        contact_first_name: string | null;
        contact_last_name: string | null;
        contact_email: string | null;
        contact_mobile: string | null;
        closed_at: Date | null;
    } | {
        account_id: number | null;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.record_status;
        created_by: string | null;
        modified_by: string | null;
        master_template: boolean;
        editable: boolean | null;
    } | {
        ok: boolean;
    }>;
    private parseId;
    private stubList;
    private scope;
    getDisputeStats(user: JwtPayload): Promise<{
        stats: {
            counts: {
                total: number;
                open: number;
                resolved: number;
                inProgress: number;
            };
            currency: string;
            pieChartData: {
                name: string;
                value: number;
            }[];
            disputeAssignFrequencyList: never[];
        };
    }>;
    getLegalCasesStats(user: JwtPayload): Promise<{
        legalCases: never[];
        totalRecords: number;
        currentPage: number;
        totalPages: number;
        currency: string;
        totalAmount: number;
        totalCustomers: number;
    }>;
    private emptyNotificationStats;
    private listNotifications;
    private getNotificationStats;
    deleteNotification(user: JwtPayload, notificationId: string): Promise<{
        success: boolean;
    }>;
    updateNotification(user: JwtPayload, notificationId: string, body: Record<string, unknown>): Promise<{
        success: boolean;
        read: boolean;
    }>;
    deleteNotificationsBulk(user: JwtPayload, body: Record<string, unknown>): Promise<{
        success: boolean;
    }>;
    private listDisputes;
    private getDispute;
    private updateDispute;
    private listDisputeReasons;
    private getDisputeReason;
    private updateDisputeReason;
}
