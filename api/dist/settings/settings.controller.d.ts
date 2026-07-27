import { DatabaseService } from "../database/database.service";
export declare class SettingsController {
    private readonly db;
    constructor(db: DatabaseService);
    currencyRates(pageRaw?: string, limitRaw?: string, searchRaw?: string, sortFieldRaw?: string, sortDirectionRaw?: string): Promise<{
        rates: {
            id: number;
            rate_date: string;
            base_currency: string;
            other_currency: string;
            currency_ratio: number;
        }[];
        totalRecords: number;
    }>;
}
