/**
 * Server-side date preset resolver for report filters.
 *
 * FilterBuilder (client) persists relative date filters as marker objects
 * like `{ __datePreset: "today" }` inside report_config / execute payloads and
 * only resolves them for display. The server must resolve the same markers to
 * concrete dates at query time — otherwise the raw marker object reaches Prisma
 * and the query throws (`Argument _ref is missing`).
 *
 * Mirrors frontend/utils/datePresetUtils.ts. Kept as a standalone copy because
 * the backend tsconfig cannot import from the frontend package.
 */
export type DatePreset = "today" | "yesterday" | "tomorrow" | "this_week" | "last_week" | "next_week" | "this_month" | "last_month" | "next_month" | "last_x_days" | "last_x_months" | "next_x_days" | "next_x_months";
export type DatePresetMarker = {
    __datePreset: DatePreset;
    __datePresetInput?: number;
};
export declare function isDatePresetMarker(value: unknown): value is DatePresetMarker;
export declare function isPeriodPreset(preset: DatePreset): boolean;
/** Resolve a single-date (point) preset to a YYYY-MM-DD string, or null. */
export declare function resolveDatePreset(preset: DatePreset, inputValue?: number, now?: Date): string | null;
/**
 * Resolve a period preset to a [startYMD, endYMD] range.
 * Returns null for point presets / unknown presets.
 */
export declare function resolveDatePresetRange(preset: DatePreset, inputValue?: number, now?: Date): [string, string] | null;
