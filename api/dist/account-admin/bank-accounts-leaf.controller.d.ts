import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class BankAccountsLeafController {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    list(user: JwtPayload, accountIdRaw?: string, include?: string): Promise<{
        id: number;
        account_id: number;
        created_at: Date;
        modified_at: Date;
        primary: boolean;
        status: boolean;
        created_by: string | null;
        modified_by: string | null;
        address_line1: string | null;
        city: string | null;
        postal_code: string | null;
        address_line2: string | null;
        country_id: number | null;
        state_id: number | null;
        beneficiary_name: string | null;
        bank_name: string | null;
        branch_number: string | null;
        branch_name: string | null;
        swift: string | null;
        iban: string | null;
        account_number: string | null;
        comments: string | null;
    }[] | {
        error: string;
    }>;
}
