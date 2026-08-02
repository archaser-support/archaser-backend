import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class BusinessUnitsService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    private isElevatedRole;
    validateAccess(user: JwtPayload, externalIds: string[]): Promise<{
        items: {
            externalId: string;
            hasAccess: boolean;
            exists: boolean;
        }[];
    }>;
    private canAccessBu;
    getAccessibleBusinessUnitIds(userBuId: number | null, isAdmin: boolean): Promise<number[] | null>;
}
