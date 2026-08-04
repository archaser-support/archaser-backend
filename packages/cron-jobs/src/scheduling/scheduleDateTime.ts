import * as ct from "countries-and-timezones";
import moment from "moment-timezone";
import { stateToTimezoneMap, weekendDaysMap } from "./timezoneMaps";

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
export async function scheduleDateTime(
    options: ScheduleDateTimeOptions
): Promise<ScheduleDateTimeResult> {
    const {
        baseDate,
        timeOfDay = "09:00",
        daysToAdd = 0,
        countryCode,
        stateCode,
        customerCountry,
        customerState,
        skipWeekends = true,
        skipHolidays = true,
        businessHoursOnly = true,
        returnUTC = true,
        preserveInputDate = false,
        isFirstStep = false,
    } = options;

    const calculationSteps: string[] = [];
    let stepNumber = 1;

    calculationSteps.push(
        `Step ${stepNumber++}: Starting with base date: ${baseDate.toISOString()}`
    );

    let targetCountryCode: string | null = null;
    let targetStateCode: string | null | undefined = null;

    if (countryCode) {
        targetCountryCode = countryCode;
        targetStateCode = stateCode;
    } else if (customerCountry) {
        targetCountryCode = customerCountry;
        targetStateCode = customerState;
    }

    if (targetCountryCode && !["US", "CA"].includes(targetCountryCode)) {
        targetStateCode = null;
    }

    let timezone: string;
    if (targetStateCode && stateToTimezoneMap[targetStateCode]) {
        timezone = stateToTimezoneMap[targetStateCode];
    } else if (targetCountryCode) {
        const country = ct.getCountry(targetCountryCode);
        if (!country?.timezones?.length) {
            throw new Error(
                `Timezone not found for country code: ${targetCountryCode}`
            );
        }
        timezone = country.timezones[0];
    } else {
        timezone = "UTC";
    }

    calculationSteps.push(
        `Step ${stepNumber++}: Determined timezone as "${timezone}" based on country "${targetCountryCode || "N/A"}" and state "${targetStateCode || "N/A"}"`
    );

    const [hours, minutes] = timeOfDay.split(":").map(Number);
    calculationSteps.push(
        `Step ${stepNumber++}: Set target time to ${timeOfDay}`
    );

    let scheduledTime: moment.Moment;

    if (preserveInputDate) {
        const inputDate = new Date(baseDate);
        const year = inputDate.getUTCFullYear();
        const month = inputDate.getUTCMonth();
        const day = inputDate.getUTCDate();
        scheduledTime = moment.tz(
            [year, month, day, hours, minutes, 0, 0],
            timezone
        );
        calculationSteps.push(
            `Step ${stepNumber++}: Preserved input date in timezone "${timezone}" → ${scheduledTime.format()}`
        );
    } else {
        const baseDateInTimezone = moment.tz(baseDate, timezone);
        scheduledTime = baseDateInTimezone.clone().set({
            hour: hours,
            minute: minutes,
            second: 0,
            millisecond: 0,
        });
        calculationSteps.push(
            `Step ${stepNumber++}: Converted base date to timezone "${timezone}" → ${scheduledTime.format()}`
        );
    }

    if (daysToAdd !== undefined && daysToAdd !== 0) {
        const stepDescription = isFirstStep
            ? "first activity delay configuration"
            : "previous step configuration";
        calculationSteps.push(
            `Step ${stepNumber++}: Adding ${daysToAdd} day(s) from ${stepDescription}`
        );

        if (skipWeekends) {
            const baseDateWithDays = new Date(
                baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000
            );
            const year = baseDateWithDays.getUTCFullYear();
            const month = baseDateWithDays.getUTCMonth();
            const day = baseDateWithDays.getUTCDate();
            scheduledTime = moment.tz(
                [year, month, day, hours, minutes, 0, 0],
                timezone
            );
        } else {
            scheduledTime = scheduledTime.add(daysToAdd, "days");
        }
        calculationSteps.push(
            `Step ${stepNumber++}: After adding days → ${scheduledTime.format()}`
        );
    }

    if (businessHoursOnly || skipWeekends) {
        const nowLocal = moment.tz(timezone);
        let daysAddedForBusinessHours = 0;
        const maxDaysToAdd = 30;
        while (
            scheduledTime.isBefore(nowLocal) &&
            daysAddedForBusinessHours < maxDaysToAdd
        ) {
            scheduledTime = scheduledTime
                .add(1, "day")
                .startOf("day")
                .set({ hour: hours, minute: minutes });
            daysAddedForBusinessHours++;
        }
        if (daysAddedForBusinessHours > 0) {
            calculationSteps.push(
                `Step ${stepNumber++}: Scheduled time was in the past, added ${daysAddedForBusinessHours} day(s) → ${scheduledTime.format()}`
            );
        }
    }

    if ((skipWeekends || skipHolidays) && targetCountryCode) {
        const weekendDays =
            weekendDaysMap[targetCountryCode] || weekendDaysMap.default;
        const isWeekend = (day: number) => weekendDays.includes(day);

        const maxAdjustments = Math.max(daysToAdd ?? 0, 14);
        let daysAddedForWeekends = 0;
        let daysAddedForHolidays = 0;
        let totalAdjustments = 0;
        let holidayService: {
            getSupportedCountries: () => string[];
            isHoliday: (
                countryCode: string,
                date: Date
            ) => { isHoliday: boolean; holidayName?: string };
        } | null = null;
        let hasHolidayCalendar = false;

        if (skipHolidays) {
            try {
                const { HolidayCalendarService } = await import(
                    "./holidayCalendarService"
                );
                holidayService = HolidayCalendarService.getInstance();
                hasHolidayCalendar = holidayService
                    .getSupportedCountries()
                    .includes(targetCountryCode);
            } catch (error) {
                calculationSteps.push(
                    `Step ${stepNumber++}: Holiday service unavailable (${(error as Error).message}), skipping holiday checks`
                );
            }
        }

        while (totalAdjustments < maxAdjustments) {
            let needsSkip = false;
            let skipReason = "";
            let isWeekendDay = false;
            let isHolidayDay = false;
            let holidayName = "";

            if (skipWeekends) {
                isWeekendDay = isWeekend(scheduledTime.day());
            }

            if (skipHolidays && hasHolidayCalendar && holidayService) {
                const localDateStr = scheduledTime.format("YYYY-MM-DD");
                const [year, month, day] = localDateStr.split("-").map(Number);
                const dateForHolidayCheck = new Date(
                    Date.UTC(year, month - 1, day, 12, 0, 0)
                );
                const holidayCheck = holidayService.isHoliday(
                    targetCountryCode,
                    dateForHolidayCheck
                );
                if (holidayCheck.isHoliday) {
                    isHolidayDay = true;
                    holidayName = holidayCheck.holidayName || "holiday";
                }
            }

            if (isWeekendDay) {
                needsSkip = true;
                skipReason = "weekend";
                daysAddedForWeekends++;
            } else if (isHolidayDay) {
                needsSkip = true;
                skipReason = holidayName;
                daysAddedForHolidays++;
            }

            if (!needsSkip) {
                break;
            }

            scheduledTime = scheduledTime
                .add(1, "day")
                .startOf("day")
                .set({ hour: hours, minute: minutes });
            totalAdjustments++;

            if (skipReason === "weekend") {
                calculationSteps.push(
                    `Step ${stepNumber++}: Scheduled time fell on weekend, skipping to next day → ${scheduledTime.format()}`
                );
            } else {
                calculationSteps.push(
                    `Step ${stepNumber++}: Scheduled time fell on ${skipReason}, skipping to next day → ${scheduledTime.format()}`
                );
            }
        }

        if (daysAddedForWeekends > 0 || daysAddedForHolidays > 0) {
            const summaryParts: string[] = [];
            if (daysAddedForWeekends > 0) {
                summaryParts.push(`${daysAddedForWeekends} weekend day(s)`);
            }
            if (daysAddedForHolidays > 0) {
                summaryParts.push(`${daysAddedForHolidays} holiday day(s)`);
            }
            calculationSteps.push(
                `Step ${stepNumber++}: Skipped ${summaryParts.join(" and ")} → ${scheduledTime.format()}`
            );
        } else {
            calculationSteps.push(
                `Step ${stepNumber++}: Scheduled time is on a valid business day, no weekend/holiday adjustment needed`
            );
        }
    }

    const finalTime = returnUTC
        ? scheduledTime.utc().toDate()
        : scheduledTime.toDate();

    calculationSteps.push(
        `Step ${stepNumber++}: Final ${returnUTC ? "UTC" : "local"} → ${finalTime.toISOString()}`
    );

    return {
        scheduledTime: finalTime,
        calculation: calculationSteps.join("\n"),
    };
}
