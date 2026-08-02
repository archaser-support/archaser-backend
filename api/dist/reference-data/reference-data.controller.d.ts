import { DatabaseService } from "../database/database.service";
export declare class ReferenceDataController {
    private readonly db;
    constructor(db: DatabaseService);
    countries(): Promise<{
        id: number;
        name: string;
        iso3: string | null;
        iso2: string | null;
        phonecode: string | null;
        emoji: string | null;
    }[]>;
    states(countryIdRaw?: string): Promise<{
        id: number;
        name: string;
        country_id: number;
        iso2: string | null;
        country_code: string;
    }[]>;
}
