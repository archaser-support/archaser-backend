import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
type DismissBody = {
    customerCollectionPeriodId: number;
    followUpTime: string;
    customerId: number;
    customerName?: string;
    action?: "dismiss" | "snooze" | "complete";
    snoozedUntil?: string;
};
export declare class AgentsFollowUpController {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    private assertReminderPermission;
    dismissed(user: JwtPayload): Promise<{
        dismissed: {
            customerCollectionPeriodId: number;
            followUpTime: string;
            snoozedUntil?: string;
        }[];
    }>;
    dismiss(user: JwtPayload, body: DismissBody): Promise<{
        success: boolean;
        updated: boolean;
    }>;
}
export {};
