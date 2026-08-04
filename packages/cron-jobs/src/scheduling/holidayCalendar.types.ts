export interface HolidayCalendar {
    countryCode: string;
    holidays: {
        date: string;
        name: string;
        type: "national" | "religious" | "observance";
    }[];
}
