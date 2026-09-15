/**
 * Breach persistence vs dilution (KPI #11) + breach clean-streak / episode
 * tracking (KPI #12) from CTP daily series.
 *
 * Dilution only applies when health is rising and the customer has breach
 * history. Never-breached customers are `na` (not "resolved").
 *
 * Streaks reuse {@link analyzeBooleanDaySeries} / {@link enumerateBooleanDayRuns};
 * missing snapshot days break runs and are never treated as clean.
 */

import {
    analyzeBooleanDaySeries,
    enumerateBooleanDayRuns,
    type BooleanDaySeriesAnalysis,
    type CtpSnapshotDay,
    type StreakWindow,
} from "./ctpDailySeries";

/** Suppress dilution classification under ~14 available days. */
export const BREACH_DILUTION_MIN_DAYS = 14;

/** Health must rise by at least this many points (last − first) to classify. */
export const BREACH_DILUTION_HEALTH_RISE_MIN_PTS = 5;

/**
 * Breach amount decline ≥ this fraction of the early reference → resolved
 * ("fell sharply"). End-at-zero after a past breach also counts as resolved.
 */
export const BREACH_RESOLVED_MIN_DECLINE = 0.5;

/**
 * Breach amount decline below this fraction (while end breach stays > 0) is
 * treated as flat / persistent.
 */
export const BREACH_PERSISTENT_MAX_DECLINE = 0.1;

/** AR must grow by at least this fraction for dilution (with persistent breach). */
export const BREACH_DILUTION_AR_GROWTH_MIN = 0.15;

export type BreachDilutionClassification =
    | "diluted"
    | "resolved"
    | "na"
    | null;

export type BreachStreakStatus = "none" | "clean" | "open";

export type CtpBreachDayPoint = CtpSnapshotDay & {
    termsBreachAmount: number;
    totalReceivables: number;
    /**
     * Daily health index (0–100). When null, health rise uses compliant/total
     * if both receivable fields are present on the merged day; otherwise the
     * day is skipped for health endpoints.
     */
    healthIndex: number | null;
};

export type BreachDilutionThresholds = {
    minDays?: number;
    healthRiseMinPts?: number;
    resolvedMinDecline?: number;
    persistentMaxDecline?: number;
    arGrowthMin?: number;
};

export type BreachEpisode = {
    start: string;
    /** Inclusive end of the available-day run. */
    end: string;
    days: number;
    /** Max terms_breach_amount during the episode. */
    peakAmount: number;
    /** True when the episode ends on the last available day and that day is in breach. */
    ongoing: boolean;
};

export type BreachDilutionMetrics = {
    daysAvailable: number;
    hasBreachHistory: boolean;
    /** True when daysAvailable < minDays (classification forced null / na only for never-breached). */
    suppressed: boolean;
    classification: BreachDilutionClassification;
    healthFirst: number | null;
    healthLast: number | null;
    healthRisePts: number | null;
    breachFirst: number | null;
    breachLast: number | null;
    /** (last − first) / |first| when first ≠ 0; null otherwise. */
    breachChangePct: number | null;
    arFirst: number | null;
    arLast: number | null;
    /** (last − first) / |first| when first ≠ 0; null otherwise. */
    arGrowthPct: number | null;
};

export type BreachStreakMetrics = {
    daysAvailable: number;
    hasBreachHistory: boolean;
    breachDayCount: number;
    /** Null when zero available days. */
    pctDaysInBreach: number | null;
    status: BreachStreakStatus;
    /** Days for the badge (0 when status is `none`). */
    streakDays: number;
    streakStart: string | null;
    streakEnd: string | null;
    currentBreachStreak: StreakWindow;
    currentCleanStreak: StreakWindow;
    longestBreachStreak: StreakWindow;
    episodes: BreachEpisode[];
    episodeCount: number;
    series: BooleanDaySeriesAnalysis;
};

export type CustomerBreachDilutionStreakMetrics = BreachDilutionMetrics &
    BreachStreakMetrics;

export type CustomerBreachDilutionStreakRow =
    CustomerBreachDilutionStreakMetrics & {
        customerId: number;
        customerName: string;
    };

export type PortfolioBreachDilutionStreakSummary = {
    customersWithData: number;
    dilutedCustomerCount: number;
    resolvedCustomerCount: number;
    customersWithBreachHistory: number;
    customersCurrentlyInBreach: number;
    customersBreachFree: number;
    customersNeverBreached: number;
};

function emptyStreakWindow(): StreakWindow {
    return { days: 0, start: null, end: null };
}

function emptyDilution(
    overrides?: Partial<BreachDilutionMetrics>
): BreachDilutionMetrics {
    return {
        daysAvailable: 0,
        hasBreachHistory: false,
        suppressed: true,
        classification: "na",
        healthFirst: null,
        healthLast: null,
        healthRisePts: null,
        breachFirst: null,
        breachLast: null,
        breachChangePct: null,
        arFirst: null,
        arLast: null,
        arGrowthPct: null,
        ...overrides,
    };
}

function emptyStreak(
    overrides?: Partial<BreachStreakMetrics>
): BreachStreakMetrics {
    const series = analyzeBooleanDaySeries([]);
    return {
        daysAvailable: 0,
        hasBreachHistory: false,
        breachDayCount: 0,
        pctDaysInBreach: null,
        status: "none",
        streakDays: 0,
        streakStart: null,
        streakEnd: null,
        currentBreachStreak: emptyStreakWindow(),
        currentCleanStreak: emptyStreakWindow(),
        longestBreachStreak: emptyStreakWindow(),
        episodes: [],
        episodeCount: 0,
        series,
        ...overrides,
    };
}

function relativeChange(first: number, last: number): number | null {
    if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
        return null;
    }
    return (last - first) / Math.abs(first);
}

/** True when the day counts as in-breach. */
export function isTermsBreachDay(termsBreachAmount: number): boolean {
    return Number.isFinite(termsBreachAmount) && termsBreachAmount > 0;
}

type MergedBreachDay = {
    snapshotDate: string;
    termsBreachAmount: number;
    totalReceivables: number;
    healthIndex: number | null;
};

/**
 * Aggregate multi-policy CTP rows for one customer/day: sum breach + AR;
 * health from weighted compliant/total when health is missing, else mean of
 * provided health indexes.
 */
export function mergeBreachDayPoints(
    points: CtpBreachDayPoint[]
): MergedBreachDay[] {
    const byDate = new Map<
        string,
        {
            termsBreachAmount: number;
            totalReceivables: number;
            healthSum: number;
            healthWeight: number;
        }
    >();

    for (const point of points) {
        const breach = Number.isFinite(point.termsBreachAmount)
            ? Math.max(0, point.termsBreachAmount)
            : 0;
        const ar = Number.isFinite(point.totalReceivables)
            ? Math.max(0, point.totalReceivables)
            : 0;
        let entry = byDate.get(point.snapshotDate);
        if (!entry) {
            entry = {
                termsBreachAmount: 0,
                totalReceivables: 0,
                healthSum: 0,
                healthWeight: 0,
            };
            byDate.set(point.snapshotDate, entry);
        }
        entry.termsBreachAmount += breach;
        entry.totalReceivables += ar;
        if (point.healthIndex != null && Number.isFinite(point.healthIndex)) {
            entry.healthSum += point.healthIndex;
            entry.healthWeight += 1;
        }
    }

    return [...byDate.entries()]
        .map(([snapshotDate, entry]) => {
            let healthIndex: number | null = null;
            if (entry.healthWeight > 0) {
                healthIndex = entry.healthSum / entry.healthWeight;
            }
            return {
                snapshotDate,
                termsBreachAmount: entry.termsBreachAmount,
                totalReceivables: entry.totalReceivables,
                healthIndex,
            };
        })
        .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
}

/**
 * Classify rising-health recovery as diluted vs resolved.
 * Never-breached → `na`. Short windows → suppressed with null classification
 * (except never-breached stays `na`).
 */
export function classifyBreachDilution(
    points: CtpBreachDayPoint[],
    thresholds?: BreachDilutionThresholds
): BreachDilutionMetrics {
    const minDays = thresholds?.minDays ?? BREACH_DILUTION_MIN_DAYS;
    const healthRiseMin =
        thresholds?.healthRiseMinPts ?? BREACH_DILUTION_HEALTH_RISE_MIN_PTS;
    const resolvedMinDecline =
        thresholds?.resolvedMinDecline ?? BREACH_RESOLVED_MIN_DECLINE;
    const persistentMaxDecline =
        thresholds?.persistentMaxDecline ?? BREACH_PERSISTENT_MAX_DECLINE;
    const arGrowthMin =
        thresholds?.arGrowthMin ?? BREACH_DILUTION_AR_GROWTH_MIN;

    const merged = mergeBreachDayPoints(points);
    const daysAvailable = merged.length;
    if (daysAvailable === 0) {
        return emptyDilution();
    }

    const hasBreachHistory = merged.some((p) =>
        isTermsBreachDay(p.termsBreachAmount)
    );
    const first = merged[0];
    const last = merged[merged.length - 1];

    const healthPoints = merged.filter(
        (p) => p.healthIndex != null && Number.isFinite(p.healthIndex)
    );
    const healthFirst =
        healthPoints.length > 0 ? healthPoints[0].healthIndex : null;
    const healthLast =
        healthPoints.length > 0
            ? healthPoints[healthPoints.length - 1].healthIndex
            : null;
    const healthRisePts =
        healthFirst != null && healthLast != null
            ? healthLast - healthFirst
            : null;

    // Early breach reference: first day with breach > 0 (not window day 0 when
    // breach starts mid-window). Last breach is the last available day.
    const firstBreachDay = merged.find((p) =>
        isTermsBreachDay(p.termsBreachAmount)
    );
    const breachFirst = firstBreachDay?.termsBreachAmount ?? first.termsBreachAmount;
    const breachLast = last.termsBreachAmount;
    const breachChangePct = relativeChange(breachFirst, breachLast);

    const arFirst = first.totalReceivables;
    const arLast = last.totalReceivables;
    const arGrowthPct = relativeChange(arFirst, arLast);

    if (!hasBreachHistory) {
        return {
            daysAvailable,
            hasBreachHistory: false,
            suppressed: daysAvailable < minDays,
            classification: "na",
            healthFirst,
            healthLast,
            healthRisePts,
            breachFirst: 0,
            breachLast: 0,
            breachChangePct: null,
            arFirst,
            arLast,
            arGrowthPct,
        };
    }

    if (daysAvailable < minDays) {
        return {
            daysAvailable,
            hasBreachHistory: true,
            suppressed: true,
            classification: null,
            healthFirst,
            healthLast,
            healthRisePts,
            breachFirst,
            breachLast,
            breachChangePct,
            arFirst,
            arLast,
            arGrowthPct,
        };
    }

    const healthRising =
        healthRisePts != null && healthRisePts >= healthRiseMin;
    if (!healthRising) {
        return {
            daysAvailable,
            hasBreachHistory: true,
            suppressed: false,
            classification: null,
            healthFirst,
            healthLast,
            healthRisePts,
            breachFirst,
            breachLast,
            breachChangePct,
            arFirst,
            arLast,
            arGrowthPct,
        };
    }

    const breachEnded = !isTermsBreachDay(breachLast);
    const breachDeclinePct =
        breachChangePct != null ? -breachChangePct : breachEnded ? 1 : null;
    const fellSharply =
        breachEnded ||
        (breachDeclinePct != null && breachDeclinePct >= resolvedMinDecline);

    if (fellSharply) {
        return {
            daysAvailable,
            hasBreachHistory: true,
            suppressed: false,
            classification: "resolved",
            healthFirst,
            healthLast,
            healthRisePts,
            breachFirst,
            breachLast,
            breachChangePct,
            arFirst,
            arLast,
            arGrowthPct,
        };
    }

    const persistent =
        isTermsBreachDay(breachLast) &&
        (breachDeclinePct == null ||
            breachDeclinePct < persistentMaxDecline ||
            (breachChangePct != null && breachChangePct >= 0));
    const arGrew = arGrowthPct != null && arGrowthPct >= arGrowthMin;

    if (persistent && arGrew) {
        return {
            daysAvailable,
            hasBreachHistory: true,
            suppressed: false,
            classification: "diluted",
            healthFirst,
            healthLast,
            healthRisePts,
            breachFirst,
            breachLast,
            breachChangePct,
            arFirst,
            arLast,
            arGrowthPct,
        };
    }

    return {
        daysAvailable,
        hasBreachHistory: true,
        suppressed: false,
        classification: null,
        healthFirst,
        healthLast,
        healthRisePts,
        breachFirst,
        breachLast,
        breachChangePct,
        arFirst,
        arLast,
        arGrowthPct,
    };
}

/**
 * Breach clean-streak / open-breach badge + episode history.
 * Never invents a huge clean streak for never-breached customers.
 */
export function computeBreachStreakMetrics(
    points: CtpBreachDayPoint[]
): BreachStreakMetrics {
    const merged = mergeBreachDayPoints(points);
    if (merged.length === 0) {
        return emptyStreak();
    }

    const booleanPoints = merged.map((p) => ({
        snapshotDate: p.snapshotDate,
        flag: isTermsBreachDay(p.termsBreachAmount),
    }));
    const series = analyzeBooleanDaySeries(booleanPoints);
    const hasBreachHistory = series.activeDayCount > 0;
    const last = merged[merged.length - 1];
    const lastInBreach = isTermsBreachDay(last.termsBreachAmount);

    const breachByDate = new Map(
        merged.map((p) => [p.snapshotDate, p.termsBreachAmount] as const)
    );
    const runs = enumerateBooleanDayRuns(booleanPoints);
    const episodes: BreachEpisode[] = runs
        .filter((run) => run.flag)
        .map((run) => {
            let peakAmount = 0;
            for (const [ymd, amount] of breachByDate) {
                if (ymd >= run.start && ymd <= run.end) {
                    peakAmount = Math.max(peakAmount, amount);
                }
            }
            const ongoing = lastInBreach && run.end === last.snapshotDate;
            return {
                start: run.start,
                end: run.end,
                days: run.days,
                peakAmount,
                ongoing,
            };
        });

    let status: BreachStreakStatus = "none";
    let streakDays = 0;
    let streakStart: string | null = null;
    let streakEnd: string | null = null;

    if (!hasBreachHistory) {
        status = "none";
    } else if (lastInBreach) {
        status = "open";
        streakDays = series.currentActiveStreak.days;
        streakStart = series.currentActiveStreak.start;
        streakEnd = series.currentActiveStreak.end;
    } else {
        status = "clean";
        streakDays = series.currentInactiveStreak.days;
        streakStart = series.currentInactiveStreak.start;
        streakEnd = series.currentInactiveStreak.end;
    }

    return {
        daysAvailable: series.daysAvailable,
        hasBreachHistory,
        breachDayCount: series.activeDayCount,
        pctDaysInBreach: series.pctActiveDays,
        status,
        streakDays,
        streakStart,
        streakEnd,
        currentBreachStreak: series.currentActiveStreak,
        currentCleanStreak: hasBreachHistory
            ? series.currentInactiveStreak
            : emptyStreakWindow(),
        longestBreachStreak: series.longestActiveStreak,
        episodes,
        episodeCount: episodes.length,
        series,
    };
}

export function computeCustomerBreachDilutionStreakMetrics(
    points: CtpBreachDayPoint[],
    thresholds?: BreachDilutionThresholds
): CustomerBreachDilutionStreakMetrics {
    const dilution = classifyBreachDilution(points, thresholds);
    const streak = computeBreachStreakMetrics(points);
    return {
        ...dilution,
        ...streak,
        // Prefer dilution's daysAvailable / hasBreachHistory (same merged series).
        daysAvailable: dilution.daysAvailable,
        hasBreachHistory: dilution.hasBreachHistory,
    };
}

export function summarizePortfolioBreachDilutionStreak(
    rows: Array<
        Pick<
            CustomerBreachDilutionStreakMetrics,
            | "daysAvailable"
            | "classification"
            | "hasBreachHistory"
            | "status"
        >
    >
): PortfolioBreachDilutionStreakSummary {
    const withData = rows.filter((r) => r.daysAvailable > 0);
    return {
        customersWithData: withData.length,
        dilutedCustomerCount: withData.filter(
            (r) => r.classification === "diluted"
        ).length,
        resolvedCustomerCount: withData.filter(
            (r) => r.classification === "resolved"
        ).length,
        customersWithBreachHistory: withData.filter((r) => r.hasBreachHistory)
            .length,
        customersCurrentlyInBreach: withData.filter((r) => r.status === "open")
            .length,
        customersBreachFree: withData.filter((r) => r.status === "clean")
            .length,
        customersNeverBreached: withData.filter((r) => r.status === "none")
            .length,
    };
}

/** Diluted customers ranked by AR growth (desc), then breach amount. */
export function rankDilutedCustomers(
    rows: CustomerBreachDilutionStreakRow[]
): CustomerBreachDilutionStreakRow[] {
    return rows
        .filter((r) => r.classification === "diluted")
        .sort((a, b) => {
            const ag = a.arGrowthPct ?? -Infinity;
            const bg = b.arGrowthPct ?? -Infinity;
            if (bg !== ag) {
                return bg - ag;
            }
            return (b.breachLast ?? 0) - (a.breachLast ?? 0);
        });
}

/** Compact exportable episode history line for report grids. */
export function formatBreachEpisodesSummary(
    episodes: BreachEpisode[]
): string {
    if (episodes.length === 0) {
        return "";
    }
    return episodes
        .map((ep) => {
            const endLabel = ep.ongoing ? `${ep.end}*` : ep.end;
            return `${ep.start}→${endLabel} (${ep.days}d, peak ${Math.round(ep.peakAmount)})`;
        })
        .join("; ");
}

export function latestBreachEpisode(
    episodes: BreachEpisode[]
): BreachEpisode | null {
    if (episodes.length === 0) {
        return null;
    }
    return episodes.reduce((best, ep) => (ep.end >= best.end ? ep : best));
}
