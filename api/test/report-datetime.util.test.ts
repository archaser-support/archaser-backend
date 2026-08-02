import { formatReportDateTime } from "../src/reports/report-datetime.util";

describe("formatReportDateTime", () => {
    // UTC 07:54 on 2025-12-16 → Jerusalem 09:54 / Kolkata 13:24 (winter)
    const utc = new Date("2025-12-16T07:54:00.000Z");

    it("formats in Asia/Jerusalem for he-IL as 16.12.2025, 09:54", () => {
        expect(
            formatReportDateTime(utc, "he-IL", "Asia/Jerusalem")
        ).toBe("16.12.2025, 09:54");
    });

    it("formats in Asia/Kolkata for he-IL as 16.12.2025, 13:24", () => {
        expect(
            formatReportDateTime(utc, "he-IL", "Asia/Kolkata")
        ).toBe("16.12.2025, 13:24");
    });

    it("uses the provided IANA timezone, not a hard-coded offset", () => {
        const jerusalem = formatReportDateTime(
            utc,
            "he-IL",
            "Asia/Jerusalem"
        );
        const kolkata = formatReportDateTime(utc, "he-IL", "Asia/Kolkata");
        expect(jerusalem).toBe("16.12.2025, 09:54");
        expect(kolkata).toBe("16.12.2025, 13:24");
        expect(jerusalem).not.toBe(kolkata);
    });
});
