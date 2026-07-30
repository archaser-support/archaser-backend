"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDatePresetMarker = isDatePresetMarker;
exports.isPeriodPreset = isPeriodPreset;
exports.resolveDatePreset = resolveDatePreset;
exports.resolveDatePresetRange = resolveDatePresetRange;
function isDatePresetMarker(value) {
    return (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "__datePreset" in value &&
        typeof value.__datePreset === "string");
}
const PERIOD_PRESETS = new Set([
    "this_week",
    "last_week",
    "next_week",
    "this_month",
    "last_month",
    "next_month",
    "last_x_days",
    "last_x_months",
    "next_x_days",
    "next_x_months",
]);
function isPeriodPreset(preset) {
    return PERIOD_PRESETS.has(preset);
}
function toYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function startOfToday(now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function lastDayOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function resolveDatePreset(preset, inputValue, now = new Date()) {
    const today = startOfToday(now);
    let d;
    switch (preset) {
        case "today":
            d = new Date(today);
            break;
        case "yesterday":
            d = new Date(today);
            d.setDate(today.getDate() - 1);
            break;
        case "tomorrow":
            d = new Date(today);
            d.setDate(today.getDate() + 1);
            break;
        case "this_week":
            d = new Date(today);
            d.setDate(today.getDate() - today.getDay());
            break;
        case "last_week":
            d = new Date(today);
            d.setDate(today.getDate() - today.getDay() - 7);
            break;
        case "next_week":
            d = new Date(today);
            d.setDate(today.getDate() - today.getDay() + 7);
            break;
        case "this_month":
            d = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
        case "last_month":
            d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            break;
        case "next_month":
            d = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            break;
        case "last_x_days":
            d = new Date(today);
            d.setDate(today.getDate() - (inputValue ?? 7));
            break;
        case "last_x_months":
            d = new Date(today.getFullYear(), today.getMonth() - (inputValue ?? 1), 1);
            break;
        case "next_x_days":
            d = new Date(today);
            d.setDate(today.getDate() + (inputValue ?? 7));
            break;
        case "next_x_months":
            d = new Date(today.getFullYear(), today.getMonth() + (inputValue ?? 1), 1);
            break;
        default:
            return null;
    }
    return toYMD(d);
}
function resolveDatePresetRange(preset, inputValue, now = new Date()) {
    if (!isPeriodPreset(preset)) {
        return null;
    }
    const today = startOfToday(now);
    let start;
    let end;
    switch (preset) {
        case "this_week": {
            start = new Date(today);
            start.setDate(today.getDate() - today.getDay());
            end = new Date(start);
            end.setDate(start.getDate() + 6);
            break;
        }
        case "last_week": {
            start = new Date(today);
            start.setDate(today.getDate() - today.getDay() - 7);
            end = new Date(start);
            end.setDate(start.getDate() + 6);
            break;
        }
        case "next_week": {
            start = new Date(today);
            start.setDate(today.getDate() - today.getDay() + 7);
            end = new Date(start);
            end.setDate(start.getDate() + 6);
            break;
        }
        case "this_month": {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            end = lastDayOfMonth(start);
            break;
        }
        case "last_month": {
            start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            end = lastDayOfMonth(start);
            break;
        }
        case "next_month": {
            start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            end = lastDayOfMonth(start);
            break;
        }
        case "last_x_days": {
            end = new Date(today);
            start = new Date(today);
            start.setDate(today.getDate() - (inputValue ?? 7));
            break;
        }
        case "last_x_months": {
            start = new Date(today.getFullYear(), today.getMonth() - (inputValue ?? 1), 1);
            end = lastDayOfMonth(start);
            break;
        }
        case "next_x_days": {
            start = new Date(today);
            end = new Date(today);
            end.setDate(today.getDate() + (inputValue ?? 7));
            break;
        }
        case "next_x_months": {
            start = new Date(today.getFullYear(), today.getMonth() + (inputValue ?? 1), 1);
            end = lastDayOfMonth(start);
            break;
        }
        default:
            return null;
    }
    return [toYMD(start), toYMD(end)];
}
//# sourceMappingURL=date-preset.util.js.map