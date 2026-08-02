import { JwtPayload } from "../auth/auth.service";
import { BusinessUnitsService } from "./business-units.service";
export declare class BusinessUnitsController {
    private readonly businessUnits;
    constructor(businessUnits: BusinessUnitsService);
    validateAccess(user: JwtPayload, body: {
        externalIds?: string[];
    }): Promise<{
        items: {
            externalId: string;
            hasAccess: boolean;
            exists: boolean;
        }[];
    }>;
}
