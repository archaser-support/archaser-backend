import {
    followUpTimeWhere,
    type FollowUpTimeWhere,
} from "../src/system/agents-follow-up-date-range";

describe("followUpTimeWhere", () => {
    const wednesday = new Date(2026, 7, 26, 15, 30, 0); // Wed 26 Aug 2026

    it("all (default) returns any non-null follow_up_time — past or future", () => {
        expect(followUpTimeWhere("all", wednesday)).toEqual({ not: null });
        expect(followUpTimeWhere(undefined, wednesday)).toEqual({ not: null });
        expect(followUpTimeWhere("ALL", wednesday)).toEqual({ not: null });
    });

    it("today is [start of day, next day)", () => {
        const filter = followUpTimeWhere("today", wednesday) as Extract<
            FollowUpTimeWhere,
            { gte: Date }
        >;
        expect(filter.not).toBeNull();
        expect(filter.gte).toEqual(new Date(2026, 7, 26));
        expect(filter.lt).toEqual(new Date(2026, 7, 27));
    });

    it("this_week is Sunday–Saturday of the current week", () => {
        const filter = followUpTimeWhere("this_week", wednesday) as Extract<
            FollowUpTimeWhere,
            { gte: Date }
        >;
        // Sun 23 Aug 2026 → Sun 30 Aug 2026
        expect(filter.gte).toEqual(new Date(2026, 7, 23));
        expect(filter.lt).toEqual(new Date(2026, 7, 30));
    });

    it("next_week is the following Sunday–Saturday", () => {
        const filter = followUpTimeWhere("next_week", wednesday) as Extract<
            FollowUpTimeWhere,
            { gte: Date }
        >;
        expect(filter.gte).toEqual(new Date(2026, 7, 30));
        expect(filter.lt).toEqual(new Date(2026, 8, 6));
    });

    it("this_month is [1st of month, 1st of next month)", () => {
        const filter = followUpTimeWhere("this_month", wednesday) as Extract<
            FollowUpTimeWhere,
            { gte: Date }
        >;
        expect(filter.gte).toEqual(new Date(2026, 7, 1));
        expect(filter.lt).toEqual(new Date(2026, 8, 1));
    });
});
