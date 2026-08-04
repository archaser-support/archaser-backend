import { HolidayCalendar } from "./holidayCalendar.types";
export declare class HolidayCalendarService {
    private static instance;
    private holidayCalendars;
    private generatedHolidaysCache;
    private constructor();
    static getInstance(): HolidayCalendarService;
    /**
     * Get holidays for a specific country and year
     * Uses in-memory cache to avoid recalculating holidays for the same country/year combination
     */
    getHolidays(countryCode: string, year?: number): HolidayCalendar | null;
    /**
     * Check if a specific date is a holiday in a country
     */
    isHoliday(countryCode: string, date: Date): {
        isHoliday: boolean;
        holidayName?: string;
    };
    /**
     * Get all supported countries
     */
    getSupportedCountries(): string[];
    /**
     * Clear the generated holidays cache
     * Useful for testing or when you need to force recalculation
     */
    clearCache(): void;
    /**
     * Initialize comprehensive holiday calendars
     */
    private initializeHolidayCalendars;
    /**
     * Generate holidays for a specific year
     */
    private generateHolidaysForYear;
    /**
     * Get variable holidays that change each year (like Easter, Hebrew calendar, Islamic calendar)
     */
    private getVariableHolidays;
    /**
     * Get Hebrew calendar holidays for Israel
     */
    private getHebrewCalendarHolidays;
    /**
     * Get Islamic calendar holidays
     */
    private getIslamicCalendarHolidays;
    /**
     * Simplified Hebrew calendar calculations
     */
    private calculateRoshHashanah;
    private calculatePassover;
    /**
     * Simplified Islamic calendar calculations
     */
    private calculateEidAlFitr;
    private calculateEidAlAdha;
    private calculateIslamicNewYear;
    /**
     * Simplified Chinese New Year calculation
     */
    private getChineseNewYear;
    /**
     * Calculate Easter date using Meeus/Jones/Butcher algorithm
     */
    private calculateEaster;
    /**
     * Get the nth occurrence of a specific day in a month
     */
    private getNthDayOfMonth;
    /**
     * Get holidays for a date range
     */
    getHolidaysInRange(countryCode: string, startDate: Date, endDate: Date): Array<{
        date: string;
        name: string;
        type: string;
    }>;
    /**
     * Get supported calendar types for a country
     */
    getCalendarTypes(countryCode: string): string[];
}
