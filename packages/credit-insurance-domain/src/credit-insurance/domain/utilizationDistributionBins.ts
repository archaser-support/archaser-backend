/** 5 under-100% + 5 at/over-100% bands for portfolio utilization distribution. */
export const UTILIZATION_DISTRIBUTION_BIN_KEYS = [
    "0_20",
    "20_40",
    "40_60",
    "60_80",
    "80_100",
    "100_110",
    "110_120",
    "120_130",
    "130_150",
    "150_plus",
] as const;

export type UtilizationDistributionBinKey =
    (typeof UTILIZATION_DISTRIBUTION_BIN_KEYS)[number];

export function isUtilizationDistributionBinKey(
    value: string
): value is UtilizationDistributionBinKey {
    return (UTILIZATION_DISTRIBUTION_BIN_KEYS as readonly string[]).includes(
        value
    );
}

/**
 * Exclusive bins: [0,20), [20,40), … [80,100), [100,110), … [150,∞).
 * Exactly 100% lands in 100_110.
 */
export function assignUtilizationDistributionBin(
    utilizationPct: number
): UtilizationDistributionBinKey {
    if (utilizationPct < 20) {
        return "0_20";
    }
    if (utilizationPct < 40) {
        return "20_40";
    }
    if (utilizationPct < 60) {
        return "40_60";
    }
    if (utilizationPct < 80) {
        return "60_80";
    }
    if (utilizationPct < 100) {
        return "80_100";
    }
    if (utilizationPct < 110) {
        return "100_110";
    }
    if (utilizationPct < 120) {
        return "110_120";
    }
    if (utilizationPct < 130) {
        return "120_130";
    }
    if (utilizationPct < 150) {
        return "130_150";
    }
    return "150_plus";
}

/** Risk tint zone for histogram bars (aligned to bin edges). */
export type UtilizationDistributionRiskZone = "calm" | "warning" | "danger";

export function utilizationDistributionRiskZone(
    bin: UtilizationDistributionBinKey
): UtilizationDistributionRiskZone {
    if (
        bin === "0_20" ||
        bin === "20_40" ||
        bin === "40_60" ||
        bin === "60_80"
    ) {
        return "calm";
    }
    if (bin === "80_100") {
        return "warning";
    }
    return "danger";
}
