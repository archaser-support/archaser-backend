import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class SearchService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    globalSearch(user: JwtPayload, searchTerm?: string): Promise<{
        results: ({
            id: number;
            type: "customer";
            name: string;
            subtitle: string | null;
            customerId: number;
            relevanceScore: number;
            metadata: {
                type: import(".prisma/client").$Enums.client_type;
                customer_number: string | null;
                collection_status: import(".prisma/client").$Enums.record_status;
                total_invoices_overdue: number | null;
                total_invoices_overdue_formatted: string | null;
                parent_customer_name: string | null;
                current_category: import(".prisma/client").$Enums.category | null;
            };
        } | {
            id: number;
            type: "invoice";
            name: string | null;
            subtitle: string;
            customerId: number | null;
            relevanceScore: number;
            metadata: {
                invoice_number: string | null;
                amount: number | null;
                amount_formatted: string | null;
                status: import(".prisma/client").$Enums.invoice_status;
                invoice_date: string | null;
            };
        } | {
            id: number;
            type: "contact";
            name: string;
            subtitle: string | null;
            customerId: number | null;
            relevanceScore: number;
            metadata: {
                email: string | null;
                phone: string | null;
                mobile: string | null;
                role: string | null;
                company_name: string;
            };
        } | {
            id: number;
            type: "dispute";
            name: string;
            subtitle: string;
            customerId: number;
            relevanceScore: number;
            metadata: {
                dispute_id: number;
                reason: string;
                status: import(".prisma/client").$Enums.dispute_status | null;
                created_at: string | null;
            };
        })[];
        totalCount: number;
        countsByType: {
            customer: number;
            invoice: number;
            contact: number;
            dispute: number;
        };
        hasMore: boolean;
    } | {
        results: never[];
    }>;
    private searchCustomers;
    private searchInvoices;
    private searchContacts;
    private searchDisputes;
}
