import { DatabaseService } from "../database/database.service";
export declare class ReferenceDataController {
    private readonly db;
    constructor(db: DatabaseService);
    countries(): Promise<{
        name: string;
        id: number;
        iso3: string | null;
        iso2: string | null;
        phonecode: string | null;
        emoji: string | null;
    }[]>;
    states(countryIdRaw?: string): Promise<{
        name: string;
        id: number;
        country_id: number;
        iso2: string | null;
        country_code: string;
    }[]>;
}
