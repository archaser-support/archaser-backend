import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class InvoicePaymentDateController {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    updateLastPaymentDate(user: JwtPayload, body: Record<string, unknown>): Promise<{
        success: boolean;
        invoice: {
            id: number;
            customer_id: number | null;
            last_payment_date: Date | null;
        };
    }>;
}
