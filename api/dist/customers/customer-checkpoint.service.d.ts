import { OnModuleInit } from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export type CustomerCheckpointRowCounts = {
    invoices: number;
    invoicePayments: number;
    payments: number;
    collectionPeriods: number;
    activities: number;
    activityContacts: number;
    disputes: number;
    disputeInvoices: number;
    customerPolicies: number;
    customerTopUps: number;
    contacts: number;
    customerBanks: number;
    hasAggregatedData: boolean;
};
export type CustomerCheckpointStatus = {
    exists: boolean;
    savedAt: string | null;
    savedBy: string | null;
    rowCounts?: CustomerCheckpointRowCounts;
};
export type CustomerCheckpointRestoreSummary = {
    restoredAt: string;
    rowCounts: CustomerCheckpointRowCounts;
};
export declare class CustomerCheckpointService implements OnModuleInit {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    onModuleInit(): void;
    private assertCheckpointAccess;
    private resolveScope;
    private capture;
    getStatus(user: JwtPayload, customerId: number): Promise<CustomerCheckpointStatus>;
    save(user: JwtPayload, customerId: number): Promise<CustomerCheckpointStatus>;
    restore(user: JwtPayload, customerId: number): Promise<CustomerCheckpointRestoreSummary>;
}
