"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HolidayCalendarService = void 0;
class HolidayCalendarService {
    constructor() {
        this.holidayCalendars = new Map();
        // Cache for generated year-specific holiday calendars (key: "countryCode-year", e.g., "IL-2024")
        this.generatedHolidaysCache = new Map();
        this.initializeHolidayCalendars();
    }
    static getInstance() {
        if (!HolidayCalendarService.instance) {
            HolidayCalendarService.instance = new HolidayCalendarService();
        }
        return HolidayCalendarService.instance;
    }
    /**
     * Get holidays for a specific country and year
     * Uses in-memory cache to avoid recalculating holidays for the same country/year combination
     */
    getHolidays(countryCode, year = new Date().getFullYear()) {
        const calendar = this.holidayCalendars.get(countryCode);
        if (!calendar)
            return null;
        // Check cache first
        const cacheKey = `${countryCode}-${year}`;
        const cached = this.generatedHolidaysCache.get(cacheKey);
        if (cached) {
            return cached;
        }
        // Generate holidays for the specific year
        const generated = this.generateHolidaysForYear(calendar, year);
        // Store in cache for future use
        this.generatedHolidaysCache.set(cacheKey, generated);
        return generated;
    }
    /**
     * Check if a specific date is a holiday in a country
     */
    isHoliday(countryCode, date) {
        const calendar = this.getHolidays(countryCode, date.getFullYear());
        if (!calendar)
            return { isHoliday: false };
        const dateStr = date.toISOString().split("T")[0];
        const holiday = calendar.holidays.find((h) => h.date === dateStr);
        return {
            isHoliday: !!holiday,
            holidayName: holiday?.name,
        };
    }
    /**
     * Get all supported countries
     */
    getSupportedCountries() {
        return Array.from(this.holidayCalendars.keys());
    }
    /**
     * Clear the generated holidays cache
     * Useful for testing or when you need to force recalculation
     */
    clearCache() {
        this.generatedHolidaysCache.clear();
    }
    /**
     * Initialize comprehensive holiday calendars
     */
    initializeHolidayCalendars() {
        // United States
        this.holidayCalendars.set("US", {
            countryCode: "US",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                {
                    date: "01-15",
                    name: "Martin Luther King Jr. Day",
                    type: "national",
                },
                { date: "02-19", name: "Presidents' Day", type: "national" },
                { date: "05-27", name: "Memorial Day", type: "national" },
                { date: "07-04", name: "Independence Day", type: "national" },
                { date: "09-02", name: "Labor Day", type: "national" },
                { date: "10-14", name: "Columbus Day", type: "national" },
                { date: "11-11", name: "Veterans Day", type: "national" },
                { date: "12-25", name: "Christmas Day", type: "national" },
            ],
        });
        // United Kingdom
        this.holidayCalendars.set("GB", {
            countryCode: "GB",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "01-02", name: "Bank Holiday", type: "national" },
                {
                    date: "05-06",
                    name: "Early May Bank Holiday",
                    type: "national",
                },
                {
                    date: "05-27",
                    name: "Spring Bank Holiday",
                    type: "national",
                },
                {
                    date: "08-26",
                    name: "Summer Bank Holiday",
                    type: "national",
                },
                { date: "12-25", name: "Christmas Day", type: "religious" },
                { date: "12-26", name: "Boxing Day", type: "national" },
            ],
        });
        // Canada
        this.holidayCalendars.set("CA", {
            countryCode: "CA",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "07-01", name: "Canada Day", type: "national" },
                { date: "12-25", name: "Christmas Day", type: "religious" },
                { date: "12-26", name: "Boxing Day", type: "national" },
            ],
        });
        // Germany
        this.holidayCalendars.set("DE", {
            countryCode: "DE",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "05-01", name: "Labor Day", type: "national" },
                { date: "10-03", name: "German Unity Day", type: "national" },
                { date: "12-25", name: "Christmas Day", type: "religious" },
                { date: "12-26", name: "Boxing Day", type: "national" },
            ],
        });
        // France
        this.holidayCalendars.set("FR", {
            countryCode: "FR",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "05-01", name: "Labor Day", type: "national" },
                {
                    date: "05-08",
                    name: "Victory in Europe Day",
                    type: "national",
                },
                { date: "07-14", name: "Bastille Day", type: "national" },
                { date: "08-15", name: "Assumption Day", type: "religious" },
                { date: "11-01", name: "All Saints' Day", type: "religious" },
                { date: "11-11", name: "Armistice Day", type: "national" },
                { date: "12-25", name: "Christmas Day", type: "religious" },
            ],
        });
        // Australia
        this.holidayCalendars.set("AU", {
            countryCode: "AU",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "01-26", name: "Australia Day", type: "national" },
                { date: "04-25", name: "ANZAC Day", type: "national" },
                { date: "12-25", name: "Christmas Day", type: "religious" },
                { date: "12-26", name: "Boxing Day", type: "national" },
            ],
        });
        // Japan
        this.holidayCalendars.set("JP", {
            countryCode: "JP",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "01-02", name: "Bank Holiday", type: "national" },
                { date: "01-03", name: "Bank Holiday", type: "national" },
                { date: "05-05", name: "Children's Day", type: "national" },
                { date: "07-20", name: "Marine Day", type: "national" },
                { date: "08-11", name: "Mountain Day", type: "national" },
                { date: "09-23", name: "Autumn Equinox", type: "observance" },
                { date: "12-23", name: "Emperor's Birthday", type: "national" },
            ],
        });
        // India
        this.holidayCalendars.set("IN", {
            countryCode: "IN",
            holidays: [
                { date: "01-26", name: "Republic Day", type: "national" },
                { date: "08-15", name: "Independence Day", type: "national" },
                { date: "10-02", name: "Gandhi Jayanti", type: "national" },
            ],
        });
        // Brazil
        this.holidayCalendars.set("BR", {
            countryCode: "BR",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "04-21", name: "Tiradentes Day", type: "national" },
                { date: "05-01", name: "Labor Day", type: "national" },
                { date: "09-07", name: "Independence Day", type: "national" },
                {
                    date: "10-12",
                    name: "Our Lady of Aparecida",
                    type: "religious",
                },
                { date: "11-02", name: "All Souls' Day", type: "religious" },
                {
                    date: "11-15",
                    name: "Proclamation of the Republic",
                    type: "national",
                },
                { date: "12-25", name: "Christmas Day", type: "religious" },
            ],
        });
        // Mexico
        this.holidayCalendars.set("MX", {
            countryCode: "MX",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "02-05", name: "Constitution Day", type: "national" },
                {
                    date: "03-21",
                    name: "Benito Juárez's Birthday",
                    type: "national",
                },
                { date: "05-01", name: "Labor Day", type: "national" },
                { date: "09-16", name: "Independence Day", type: "national" },
                { date: "11-20", name: "Revolution Day", type: "national" },
                { date: "12-25", name: "Christmas Day", type: "religious" },
            ],
        });
        // South Africa
        this.holidayCalendars.set("ZA", {
            countryCode: "ZA",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "03-21", name: "Human Rights Day", type: "national" },
                { date: "04-27", name: "Freedom Day", type: "national" },
                { date: "05-01", name: "Workers' Day", type: "national" },
                { date: "06-16", name: "Youth Day", type: "national" },
                {
                    date: "08-09",
                    name: "National Women's Day",
                    type: "national",
                },
                { date: "09-24", name: "Heritage Day", type: "national" },
                {
                    date: "12-16",
                    name: "Day of Reconciliation",
                    type: "national",
                },
                { date: "12-25", name: "Christmas Day", type: "religious" },
                { date: "12-26", name: "Day of Goodwill", type: "national" },
            ],
        });
        // Singapore
        this.holidayCalendars.set("SG", {
            countryCode: "SG",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "05-01", name: "Labor Day", type: "national" },
                { date: "08-09", name: "National Day", type: "national" },
                { date: "12-25", name: "Christmas Day", type: "religious" },
            ],
        });
        // Israel - Hebrew calendar holidays (dates change every year)
        this.holidayCalendars.set("IL", {
            countryCode: "IL",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "05-14", name: "Independence Day", type: "national" },
                // Hebrew calendar holidays are calculated dynamically
            ],
        });
        // Saudi Arabia - Islamic calendar holidays
        this.holidayCalendars.set("SA", {
            countryCode: "SA",
            holidays: [
                { date: "09-23", name: "Saudi National Day", type: "national" },
                // Islamic calendar holidays are calculated dynamically
            ],
        });
        // UAE - Islamic calendar holidays
        this.holidayCalendars.set("AE", {
            countryCode: "AE",
            holidays: [
                { date: "12-02", name: "National Day", type: "national" },
                {
                    date: "12-03",
                    name: "National Day Holiday",
                    type: "national",
                },
                // Islamic calendar holidays are calculated dynamically
            ],
        });
        // China
        this.holidayCalendars.set("CN", {
            countryCode: "CN",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                { date: "05-01", name: "Labor Day", type: "national" },
                { date: "10-01", name: "National Day", type: "national" },
                {
                    date: "10-02",
                    name: "National Day Holiday",
                    type: "national",
                },
                {
                    date: "10-03",
                    name: "National Day Holiday",
                    type: "national",
                },
            ],
        });
        // South Korea
        this.holidayCalendars.set("KR", {
            countryCode: "KR",
            holidays: [
                { date: "01-01", name: "New Year's Day", type: "national" },
                {
                    date: "03-01",
                    name: "Independence Movement Day",
                    type: "national",
                },
                { date: "05-05", name: "Children's Day", type: "national" },
                { date: "06-06", name: "Memorial Day", type: "national" },
                { date: "08-15", name: "Liberation Day", type: "national" },
                {
                    date: "10-03",
                    name: "National Foundation Day",
                    type: "national",
                },
                { date: "10-09", name: "Hangul Day", type: "national" },
            ],
        });
    }
    /**
     * Generate holidays for a specific year
     */
    generateHolidaysForYear(baseCalendar, year) {
        const holidays = baseCalendar.holidays.map((holiday) => ({
            ...holiday,
            date: `${year}-${holiday.date}`,
        }));
        // Add variable holidays that change each year
        const variableHolidays = this.getVariableHolidays(baseCalendar.countryCode, year);
        holidays.push(...variableHolidays);
        return {
            countryCode: baseCalendar.countryCode,
            holidays,
        };
    }
    /**
     * Get variable holidays that change each year (like Easter, Hebrew calendar, Islamic calendar)
     */
    getVariableHolidays(countryCode, year) {
        const holidays = [];
        // Easter calculation for Christian countries
        const easterDate = this.calculateEaster(year);
        const easterFriday = new Date(easterDate);
        easterFriday.setDate(easterDate.getDate() - 2);
        const easterMonday = new Date(easterDate);
        easterMonday.setDate(easterDate.getDate() + 1);
        // Add Easter-related holidays for countries that observe them
        if (["GB", "DE", "FR", "AU"].includes(countryCode)) {
            holidays.push({
                date: easterFriday.toISOString().split("T")[0],
                name: "Good Friday",
                type: "religious",
            });
            holidays.push({
                date: easterMonday.toISOString().split("T")[0],
                name: "Easter Monday",
                type: "religious",
            });
        }
        // Add country-specific variable holidays
        switch (countryCode) {
            case "US": {
                // US has some variable holidays like Thanksgiving (4th Thursday in November)
                const thanksgivingDate = this.getNthDayOfMonth(year, 11, 4, 4); // 4th Thursday
                holidays.push({
                    date: thanksgivingDate.toISOString().split("T")[0],
                    name: "Thanksgiving Day",
                    type: "national",
                });
                break;
            }
            case "CA": {
                // Canada has variable holidays like Thanksgiving (2nd Monday in October)
                const canadaThanksgiving = this.getNthDayOfMonth(year, 10, 1, 2); // 2nd Monday
                holidays.push({
                    date: canadaThanksgiving.toISOString().split("T")[0],
                    name: "Thanksgiving Day",
                    type: "national",
                });
                break;
            }
            case "AU": {
                // Australia has variable holidays like Queen's Birthday (2nd Monday in June)
                const queensBirthday = this.getNthDayOfMonth(year, 6, 1, 2); // 2nd Monday
                holidays.push({
                    date: queensBirthday.toISOString().split("T")[0],
                    name: "Queen's Birthday",
                    type: "national",
                });
                break;
            }
            case "IL": {
                // Israel - Hebrew calendar holidays
                const hebrewHolidays = this.getHebrewCalendarHolidays(year);
                holidays.push(...hebrewHolidays);
                break;
            }
            case "SA":
            case "AE": {
                // Saudi Arabia and UAE - Islamic calendar holidays
                const islamicHolidays = this.getIslamicCalendarHolidays(year);
                holidays.push(...islamicHolidays);
                break;
            }
            case "SG": {
                // Singapore - Chinese New Year (lunar calendar)
                const chineseNewYear = this.getChineseNewYear(year);
                holidays.push({
                    date: chineseNewYear.toISOString().split("T")[0],
                    name: "Chinese New Year",
                    type: "observance",
                });
                break;
            }
        }
        return holidays;
    }
    /**
     * Get Hebrew calendar holidays for Israel
     */
    getHebrewCalendarHolidays(year) {
        const holidays = [];
        // Simplified Hebrew calendar calculations
        // In a real implementation, you would use a proper Hebrew calendar library
        // Rosh Hashanah (Jewish New Year) - approximately September/October
        const roshHashanah = this.calculateRoshHashanah(year);
        holidays.push({
            date: roshHashanah.toISOString().split("T")[0],
            name: "Rosh Hashanah",
            type: "religious",
        });
        // Yom Kippur (Day of Atonement) - 10 days after Rosh Hashanah
        const yomKippur = new Date(roshHashanah);
        yomKippur.setDate(roshHashanah.getDate() + 10);
        holidays.push({
            date: yomKippur.toISOString().split("T")[0],
            name: "Yom Kippur",
            type: "religious",
        });
        // Sukkot (Feast of Tabernacles) - 15 days after Rosh Hashanah
        const sukkot = new Date(roshHashanah);
        sukkot.setDate(roshHashanah.getDate() + 15);
        holidays.push({
            date: sukkot.toISOString().split("T")[0],
            name: "Sukkot",
            type: "religious",
        });
        // Passover - approximately March/April
        const passover = this.calculatePassover(year);
        holidays.push({
            date: passover.toISOString().split("T")[0],
            name: "Passover",
            type: "religious",
        });
        return holidays;
    }
    /**
     * Get Islamic calendar holidays
     */
    getIslamicCalendarHolidays(year) {
        const holidays = [];
        // Simplified Islamic calendar calculations
        // In a real implementation, you would use a proper Islamic calendar library
        // Eid al-Fitr (end of Ramadan) - approximately May/June
        const eidAlFitr = this.calculateEidAlFitr(year);
        holidays.push({
            date: eidAlFitr.toISOString().split("T")[0],
            name: "Eid al-Fitr",
            type: "religious",
        });
        // Eid al-Adha (Feast of Sacrifice) - approximately July/August
        const eidAlAdha = this.calculateEidAlAdha(year);
        holidays.push({
            date: eidAlAdha.toISOString().split("T")[0],
            name: "Eid al-Adha",
            type: "religious",
        });
        // Islamic New Year - approximately August/September
        const islamicNewYear = this.calculateIslamicNewYear(year);
        holidays.push({
            date: islamicNewYear.toISOString().split("T")[0],
            name: "Islamic New Year",
            type: "religious",
        });
        return holidays;
    }
    /**
     * Simplified Hebrew calendar calculations
     */
    calculateRoshHashanah(year) {
        // Simplified calculation - in reality, this is much more complex
        // Rosh Hashanah typically falls in September or early October
        const baseDate = new Date(year, 8, 15); // September 15 as base
        const dayOfWeek = baseDate.getDay();
        const offset = (1 - dayOfWeek + 7) % 7; // Adjust to Monday
        return new Date(year, 8, 15 + offset);
    }
    calculatePassover(year) {
        // Simplified calculation - Passover typically falls in March or April
        const baseDate = new Date(year, 2, 15); // March 15 as base
        const dayOfWeek = baseDate.getDay();
        const offset = (4 - dayOfWeek + 7) % 7; // Adjust to Thursday
        return new Date(year, 2, 15 + offset);
    }
    /**
     * Simplified Islamic calendar calculations
     */
    calculateEidAlFitr(year) {
        // Simplified calculation - Eid al-Fitr typically falls in May or June
        const baseDate = new Date(year, 4, 15); // May 15 as base
        const dayOfWeek = baseDate.getDay();
        const offset = (1 - dayOfWeek + 7) % 7; // Adjust to Monday
        return new Date(year, 4, 15 + offset);
    }
    calculateEidAlAdha(year) {
        // Simplified calculation - Eid al-Adha typically falls in July or August
        const baseDate = new Date(year, 6, 15); // July 15 as base
        const dayOfWeek = baseDate.getDay();
        const offset = (1 - dayOfWeek + 7) % 7; // Adjust to Monday
        return new Date(year, 6, 15 + offset);
    }
    calculateIslamicNewYear(year) {
        // Simplified calculation - Islamic New Year typically falls in August or September
        const baseDate = new Date(year, 7, 15); // August 15 as base
        const dayOfWeek = baseDate.getDay();
        const offset = (1 - dayOfWeek + 7) % 7; // Adjust to Monday
        return new Date(year, 7, 15 + offset);
    }
    /**
     * Simplified Chinese New Year calculation
     */
    getChineseNewYear(year) {
        // Simplified calculation - Chinese New Year typically falls in January or February
        const baseDate = new Date(year, 0, 15); // January 15 as base
        const dayOfWeek = baseDate.getDay();
        const offset = (1 - dayOfWeek + 7) % 7; // Adjust to Monday
        return new Date(year, 0, 15 + offset);
    }
    /**
     * Calculate Easter date using Meeus/Jones/Butcher algorithm
     */
    calculateEaster(year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month - 1, day);
    }
    /**
     * Get the nth occurrence of a specific day in a month
     */
    getNthDayOfMonth(year, month, dayOfWeek, n) {
        const firstDay = new Date(year, month - 1, 1);
        const firstDayOfWeek = firstDay.getDay();
        const offset = (dayOfWeek - firstDayOfWeek + 7) % 7;
        const targetDate = new Date(year, month - 1, 1 + offset + (n - 1) * 7);
        return targetDate;
    }
    /**
     * Get holidays for a date range
     */
    getHolidaysInRange(countryCode, startDate, endDate) {
        const holidays = [];
        const startYear = startDate.getFullYear();
        const endYear = endDate.getFullYear();
        for (let year = startYear; year <= endYear; year++) {
            const yearHolidays = this.getHolidays(countryCode, year);
            if (yearHolidays) {
                holidays.push(...yearHolidays.holidays);
            }
        }
        return holidays.filter((holiday) => {
            const holidayDate = new Date(holiday.date);
            return holidayDate >= startDate && holidayDate <= endDate;
        });
    }
    /**
     * Get supported calendar types for a country
     */
    getCalendarTypes(countryCode) {
        const calendarTypes = {
            IL: ["gregorian", "hebrew"],
            SA: ["gregorian", "islamic"],
            AE: ["gregorian", "islamic"],
            SG: ["gregorian", "chinese"],
            CN: ["gregorian", "chinese"],
            KR: ["gregorian"],
            JP: ["gregorian"],
            US: ["gregorian"],
            GB: ["gregorian"],
            CA: ["gregorian"],
            DE: ["gregorian"],
            FR: ["gregorian"],
            AU: ["gregorian"],
            IN: ["gregorian"],
            BR: ["gregorian"],
            MX: ["gregorian"],
            ZA: ["gregorian"],
        };
        return calendarTypes[countryCode] || ["gregorian"];
    }
}
exports.HolidayCalendarService = HolidayCalendarService;
