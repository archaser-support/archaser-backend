import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class UserPreferencesController {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    private resolveUserId;
    getTooltips(user: JwtPayload): Promise<{
        enabled: boolean;
        seenTooltips: {
            tooltipId: string;
            metadata: Record<string, unknown>;
        }[];
    }>;
    markSeen(user: JwtPayload, body: Record<string, unknown>): Promise<{
        error: string;
        success?: undefined;
    } | {
        success: boolean;
        error?: undefined;
    }>;
    toggle(user: JwtPayload, body: Record<string, unknown>): Promise<{
        error: string;
        success?: undefined;
        enabled?: undefined;
    } | {
        success: boolean;
        enabled: boolean;
        error?: undefined;
    }>;
    reset(user: JwtPayload): Promise<{
        success: boolean;
    }>;
}
