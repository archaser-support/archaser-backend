export declare const PORTFOLIO_HEALTH_MAX_RANGE_DAYS = 366;
export type ParsedPortfolioHealthDateRange = {
    from: string;
    to: string;
    fromDateUtc: Date;
    toDateUtc: Date;
    daysInRange: number;
};
export declare function countInclusiveCalendarDays(fromYmd: string, toYmd: string): number;
export declare function defaultPortfolioHealthDateRange(todayUtc?: Date): {
    from: string;
    to: string;
};
export declare function parsePortfolioHealthDateRange(fromRaw: string | undefined, toRaw: string | undefined): ParsedPortfolioHealthDateRange | {
    error: string;
};
