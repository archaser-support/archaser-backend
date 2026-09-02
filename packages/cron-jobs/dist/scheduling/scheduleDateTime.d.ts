export type ScheduleDateTimeOptions = {
    baseDate: Date;
    timeOfDay?: string;
    daysToAdd?: number;
    countryCode?: string | null;
    stateCode?: string | null;
    customerCountry?: string | null;
    customerState?: string | null;
    skipWeekends?: boolean;
    skipHolidays?: boolean;
    businessHoursOnly?: boolean;
    returnUTC?: boolean;
    preserveInputDate?: boolean;
    isFirstStep?: boolean;
};
export type ScheduleDateTimeResult = {
    scheduledTime: Date;
    calculation: string;
};
/**
 * Port of frontend utils/datetimeOperations scheduleDateTime.
 * Weekend and holiday skip share a unified loop (parity with frontend).
 */
export declare function scheduleDateTime(options: ScheduleDateTimeOptions): Promise<ScheduleDateTimeResult>;
