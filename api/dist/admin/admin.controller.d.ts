import { DatabaseService } from "../database/database.service";
export declare class AdminController {
    private readonly db;
    constructor(db: DatabaseService);
    private customersWithEmail;
    emailCampaignAccounts(): Promise<{
        accounts: {
            name: string;
            id: number;
            Company: {
                name: string;
            } | null;
            Person: {
                first_name: string | null;
                last_name: string | null;
                full_name: string | null;
            } | null;
            customer_number: string | null;
        }[];
    }>;
    emailCampaignCustomers(): Promise<{
        customers: {
            name: string;
            id: number;
            Company: {
                name: string;
            } | null;
            Person: {
                first_name: string | null;
                last_name: string | null;
                full_name: string | null;
            } | null;
            customer_number: string | null;
        }[];
    }>;
    emailCampaignReport(customerIdRaw?: string, accountIdRaw?: string): Promise<{
        total: number;
        delivered: number;
        failed: number;
        opened: number;
        customerId: number | null;
    }>;
}
