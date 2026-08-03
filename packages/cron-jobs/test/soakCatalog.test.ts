import {
    EXPECTED_CRON_JOB_NAMES,
    assessCronHandlerCoverage,
    readPathFlipEnv,
} from "../src/soakCatalog";

describe("worker soak catalog", () => {
    it("ports every expected CronJob name", () => {
        const coverage = assessCronHandlerCoverage();
        expect(coverage.missing).toEqual([]);
        expect(coverage.ported.length).toBe(EXPECTED_CRON_JOB_NAMES.length);
    });

    it("treats path flips as off by default", () => {
        const flags = readPathFlipEnv({});
        expect(flags.every((f) => f.enabled === false)).toBe(true);
    });
});
