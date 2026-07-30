export type DatePreset = "today" | "yesterday" | "tomorrow" | "this_week" | "last_week" | "next_week" | "this_month" | "last_month" | "next_month" | "last_x_days" | "last_x_months" | "next_x_days" | "next_x_months";
export type DatePresetMarker = {
    __datePreset: DatePreset;
    __datePresetInput?: number;
};
export declare function isDatePresetMarker(value: unknown): value is DatePresetMarker;
export declare function isPeriodPreset(preset: DatePreset): boolean;
export declare function resolveDatePreset(preset: DatePreset, inputValue?: number, now?: Date): string | null;
export declare function resolveDatePresetRange(preset: DatePreset, inputValue?: number, now?: Date): [string, string] | null;
