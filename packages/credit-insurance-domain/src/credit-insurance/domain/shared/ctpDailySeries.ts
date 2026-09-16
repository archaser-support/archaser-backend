/**
 * Shared pure helpers for Customer×Policy Trend (CTP) daily series.
 *
 * Available-day semantics (Portfolio Health convention):
 * - Only days present in the input series count toward denominators.
 * - Missing calendar days between snapshots break streaks and are never
 *   treated as "clean" / inactive / continuing a run.
 */

export type CtpSnapshotDay = {
    /** Inclusive UTC calendar day as YYYY-MM-DD. */
    snapshotDate: string;
};

export type CtpValueDayPoint = CtpSnapshotDay & {
    value: number;
};

export type CtpBooleanDayPoint = CtpSnapshotDay & {
    /** True on "active" days (over-limit, in-breach, gap, etc.). */
    flag: boolean;
};

export type CtpArDayPoint = CtpSnapshotDay & {
    totalReceivables: number;
};

/** Inclusive streak window; `days === 0` ⇒ both dates null. */
export type StreakWindow = {
    days: number;
    start: string | null;
    end: string | null;
};

/** Alias of {@link StreakWindow} for Portfolio Health exact-value trough/peak callers. */
export type ExactValueStreakWindow = StreakWindow;

export type BooleanDaySeriesAnalysis = {
    daysAvailable: number;
    activeDayCount: number;
    /** Null when there are zero available days (no invented 0%). */
    pctActiveDays: number | null;
    longestActiveStreak: StreakWindow;
    longestInactiveStreak: StreakWindow;
    /**
     * Active run ending on the last available day (0 if last day is inactive
     * or the series is empty).
     */
    currentActiveStreak: StreakWindow;
    /**
     * Inactive run ending on the last available day (0 if last day is active
     * or the series is empty). Gaps still break this run.
     */
    currentInactiveStreak: StreakWindow;
};

export type BooleanDayRunEpisode = {
    flag: boolean;
    start: string;
    end: string;
    days: number;
};

export type TrailingLinearSlopeOptions = {
    /**
     * Minimum available (non-excluded) points required to report a slope.
     * Default: 7.
     */
    minDays?: number;
    /** Drop these snapshot dates before fitting (e.g. stale / carried-forward). */
    excludeDates?: ReadonlySet<string>;
    /**
     * When set, keep only the last N remaining points after exclude/sort
     * (trailing window by available days, not calendar span).
     */
    trailingDays?: number;
    /** When false, skip R² (still returns `rSquared: null`). Default true. */
    includeRSquared?: boolean;
};

export type TrailingLinearSlopeResult = {
    /** OLS slope of value vs UTC day-number (units of value per calendar day). */
    slope: number | null;
    /** Coefficient of determination; null when suppressed, skipped, or undefined. */
    rSquared: number | null;
    /** True when fewer than `minDays` points remain after filters. */
    suppressed: boolean;
    daysUsed: number;
};

export type StaleArRun = {
    value: number;
    start: string;
    end: string;
    days: number;
    /** Carried-forward days inside this run (excludes the first day). */
    staleDates: string[];
};

export type StaleArDetectionResult = {
    staleDates: string[];
    staleDayCount: number;
    /** Same dates as `staleDates`, ready for slope/volatility exclude sets. */
    excludeSet: Set<string>;
    runs: StaleArRun[];
};

const DEFAULT_SLOPE_MIN_DAYS = 7;

/** Add `days` (may be negative) to a YYYY-MM-DD UTC calendar day. */
export function addUtcDaysToYmd(ymd: string, days: number): string {
    const [year, month, day] = ymd.split("-").map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export function utcDayPlusOne(ymd: string): string {
    return addUtcDaysToYmd(ymd, 1);
}

/** True when `next` is exactly one UTC calendar day after `prev`. */
export function areCalendarConsecutive(
    prevYmd: string,
    nextYmd: string
): boolean {
    return utcDayPlusOne(prevYmd) === nextYmd;
}

/** UTC day number (days since Unix epoch) for OLS x-axis. */
export function ymdToUtcDayNumber(ymd: string): number {
    const [year, month, day] = ymd.split("-").map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function emptyStreakWindow(): StreakWindow {
    return { days: 0, start: null, end: null };
}

function sortBySnapshotDate<T extends CtpSnapshotDay>(points: T[]): T[] {
    return [...points].sort((a, b) =>
        a.snapshotDate.localeCompare(b.snapshotDate)
    );
}

/**
 * Calendar-consecutive longest run of days whose value equals `target`.
 * When multiple equal-length streaks exist, picks the most recent (later end).
 */
export function longestExactValueStreakWindow(
    points: Array<{ snapshotDate: string; value: number }>,
    target: number
): StreakWindow {
    if (points.length === 0) {
        return emptyStreakWindow();
    }
    const sorted = sortBySnapshotDate(points);
    let bestDays = 0;
    let bestStart: string | null = null;
    let bestEnd: string | null = null;
    let current = 0;
    let currentStart: string | null = null;
    let prevDate: string | null = null;

    for (const point of sorted) {
        if (point.value !== target) {
            current = 0;
            currentStart = null;
            prevDate = point.snapshotDate;
            continue;
        }
        const continues =
            current > 0 &&
            prevDate != null &&
            areCalendarConsecutive(prevDate, point.snapshotDate);
        if (continues) {
            current += 1;
        } else {
            current = 1;
            currentStart = point.snapshotDate;
        }
        // Longer wins; equal length → most recent (ASC scan, so >= takes later).
        if (current >= bestDays) {
            bestDays = current;
            bestStart = currentStart;
            bestEnd = point.snapshotDate;
        }
        prevDate = point.snapshotDate;
    }
    return { days: bestDays, start: bestStart, end: bestEnd };
}

/** Calendar-consecutive longest run of days whose value equals `target`. */
export function longestExactValueStreak(
    points: Array<{ snapshotDate: string; value: number }>,
    target: number
): number {
    return longestExactValueStreakWindow(points, target).days;
}

/**
 * Calendar-consecutive longest run where `flag === wantFlag`.
 * Missing snapshot days break the run (same as exact-value streaks).
 */
export function longestBooleanStreakWindow(
    points: CtpBooleanDayPoint[],
    wantFlag: boolean
): StreakWindow {
    if (points.length === 0) {
        return emptyStreakWindow();
    }
    const sorted = sortBySnapshotDate(points);
    let bestDays = 0;
    let bestStart: string | null = null;
    let bestEnd: string | null = null;
    let current = 0;
    let currentStart: string | null = null;
    let prevDate: string | null = null;

    for (const point of sorted) {
        if (point.flag !== wantFlag) {
            current = 0;
            currentStart = null;
            prevDate = point.snapshotDate;
            continue;
        }
        const continues =
            current > 0 &&
            prevDate != null &&
            areCalendarConsecutive(prevDate, point.snapshotDate);
        if (continues) {
            current += 1;
        } else {
            current = 1;
            currentStart = point.snapshotDate;
        }
        if (current >= bestDays) {
            bestDays = current;
            bestStart = currentStart;
            bestEnd = point.snapshotDate;
        }
        prevDate = point.snapshotDate;
    }
    return { days: bestDays, start: bestStart, end: bestEnd };
}

/**
 * Enumerate calendar-consecutive runs of identical `flag` over available days.
 * A missing calendar day ends the current episode before the next snapshot.
 */
export function enumerateBooleanDayRuns(
    points: CtpBooleanDayPoint[]
): BooleanDayRunEpisode[] {
    if (points.length === 0) {
        return [];
    }
    const sorted = sortBySnapshotDate(points);
    const episodes: BooleanDayRunEpisode[] = [];
    let flag = sorted[0].flag;
    let start = sorted[0].snapshotDate;
    let end = sorted[0].snapshotDate;
    let days = 1;
    let prevDate = sorted[0].snapshotDate;

    for (let i = 1; i < sorted.length; i += 1) {
        const point = sorted[i];
        const consecutive = areCalendarConsecutive(prevDate, point.snapshotDate);
        if (consecutive && point.flag === flag) {
            days += 1;
            end = point.snapshotDate;
        } else {
            episodes.push({ flag, start, end, days });
            flag = point.flag;
            start = point.snapshotDate;
            end = point.snapshotDate;
            days = 1;
        }
        prevDate = point.snapshotDate;
    }
    episodes.push({ flag, start, end, days });
    return episodes;
}

function streakEndingOnLastDay(
    points: CtpBooleanDayPoint[],
    wantFlag: boolean
): StreakWindow {
    if (points.length === 0) {
        return emptyStreakWindow();
    }
    const sorted = sortBySnapshotDate(points);
    const last = sorted[sorted.length - 1];
    if (last.flag !== wantFlag) {
        return emptyStreakWindow();
    }
    let days = 1;
    let start = last.snapshotDate;
    for (let i = sorted.length - 2; i >= 0; i -= 1) {
        const point = sorted[i];
        const next = sorted[i + 1];
        if (
            point.flag === wantFlag &&
            areCalendarConsecutive(point.snapshotDate, next.snapshotDate)
        ) {
            days += 1;
            start = point.snapshotDate;
        } else {
            break;
        }
    }
    return { days, start, end: last.snapshotDate };
}

/**
 * Shared streak/run analysis for over-limit, breach, gap, and similar
 * boolean-day CTP series (available-day denominators + gap breaks).
 */
export function analyzeBooleanDaySeries(
    points: CtpBooleanDayPoint[]
): BooleanDaySeriesAnalysis {
    const sorted = sortBySnapshotDate(points);
    const daysAvailable = sorted.length;
    if (daysAvailable === 0) {
        return {
            daysAvailable: 0,
            activeDayCount: 0,
            pctActiveDays: null,
            longestActiveStreak: emptyStreakWindow(),
            longestInactiveStreak: emptyStreakWindow(),
            currentActiveStreak: emptyStreakWindow(),
            currentInactiveStreak: emptyStreakWindow(),
        };
    }
    const activeDayCount = sorted.filter((p) => p.flag).length;
    return {
        daysAvailable,
        activeDayCount,
        pctActiveDays: (100 * activeDayCount) / daysAvailable,
        longestActiveStreak: longestBooleanStreakWindow(sorted, true),
        longestInactiveStreak: longestBooleanStreakWindow(sorted, false),
        currentActiveStreak: streakEndingOnLastDay(sorted, true),
        currentInactiveStreak: streakEndingOnLastDay(sorted, false),
    };
}

/**
 * Ordinary least-squares slope of `value` vs UTC calendar day number over a
 * trailing available-day window. Missing days are already absent from `points`;
 * pass `excludeDates` (e.g. from {@link detectStaleArRuns}) to drop stale days.
 */
export function trailingLinearSlope(
    points: CtpValueDayPoint[],
    options?: TrailingLinearSlopeOptions
): TrailingLinearSlopeResult {
    const minDays = options?.minDays ?? DEFAULT_SLOPE_MIN_DAYS;
    const includeRSquared = options?.includeRSquared !== false;
    const excludeDates = options?.excludeDates;

    let filtered = sortBySnapshotDate(points).filter((p) => {
        if (!Number.isFinite(p.value)) {
            return false;
        }
        if (excludeDates?.has(p.snapshotDate)) {
            return false;
        }
        return true;
    });

    if (
        options?.trailingDays != null &&
        options.trailingDays > 0 &&
        filtered.length > options.trailingDays
    ) {
        filtered = filtered.slice(filtered.length - options.trailingDays);
    }

    const daysUsed = filtered.length;
    if (daysUsed < minDays) {
        return {
            slope: null,
            rSquared: null,
            suppressed: true,
            daysUsed,
        };
    }

    const xs = filtered.map((p) => ymdToUtcDayNumber(p.snapshotDate));
    const ys = filtered.map((p) => p.value);
    const n = daysUsed;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (let i = 0; i < n; i += 1) {
        sumX += xs[i];
        sumY += ys[i];
        sumXX += xs[i] * xs[i];
        sumXY += xs[i] * ys[i];
    }
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) {
        // All x identical (should not happen for distinct dates) — suppress.
        return {
            slope: null,
            rSquared: null,
            suppressed: true,
            daysUsed,
        };
    }
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    let rSquared: number | null = null;
    if (includeRSquared) {
        const meanY = sumY / n;
        let ssTot = 0;
        let ssRes = 0;
        for (let i = 0; i < n; i += 1) {
            const fitted = intercept + slope * xs[i];
            ssTot += (ys[i] - meanY) ** 2;
            ssRes += (ys[i] - fitted) ** 2;
        }
        if (ssTot === 0) {
            // Flat series — perfect fit, undefined R²; report 1 when residuals are 0.
            rSquared = ssRes === 0 ? 1 : null;
        } else {
            rSquared = 1 - ssRes / ssTot;
        }
    }

    return {
        slope,
        rSquared,
        suppressed: false,
        daysUsed,
    };
}

/**
 * Mark carried-forward snapshot days: calendar-consecutive runs of identical
 * **non-zero** AR where every day after the first is stale.
 *
 * Zero-AR days never start or continue a stale run. Missing calendar days break
 * the run (the first day after a gap is not stale).
 */
export function detectStaleArRuns(
    points: CtpArDayPoint[]
): StaleArDetectionResult {
    const sorted = sortBySnapshotDate(points);
    const staleDates: string[] = [];
    const runs: StaleArRun[] = [];

    if (sorted.length === 0) {
        return {
            staleDates: [],
            staleDayCount: 0,
            excludeSet: new Set(),
            runs: [],
        };
    }

    let runValue = sorted[0].totalReceivables;
    let runStart = sorted[0].snapshotDate;
    let runEnd = sorted[0].snapshotDate;
    let runDays = 1;
    let runStale: string[] = [];
    let prevDate = sorted[0].snapshotDate;

    const flushRun = () => {
        if (runValue !== 0 && runDays > 1) {
            runs.push({
                value: runValue,
                start: runStart,
                end: runEnd,
                days: runDays,
                staleDates: [...runStale],
            });
            staleDates.push(...runStale);
        }
    };

    for (let i = 1; i < sorted.length; i += 1) {
        const point = sorted[i];
        const consecutive = areCalendarConsecutive(prevDate, point.snapshotDate);
        const sameNonZero =
            consecutive &&
            point.totalReceivables !== 0 &&
            point.totalReceivables === runValue &&
            runValue !== 0;

        if (sameNonZero) {
            runDays += 1;
            runEnd = point.snapshotDate;
            runStale.push(point.snapshotDate);
        } else {
            flushRun();
            runValue = point.totalReceivables;
            runStart = point.snapshotDate;
            runEnd = point.snapshotDate;
            runDays = 1;
            runStale = [];
        }
        prevDate = point.snapshotDate;
    }
    flushRun();

    return {
        staleDates,
        staleDayCount: staleDates.length,
        excludeSet: new Set(staleDates),
        runs,
    };
}
