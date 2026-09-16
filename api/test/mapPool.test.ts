import { mapPool } from "../src/common/mapPool";

describe("mapPool", () => {
    it("preserves order with capped concurrency", async () => {
        let active = 0;
        let maxActive = 0;
        const tasks = Array.from({ length: 8 }, (_, i) => async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 5));
            active -= 1;
            return i;
        });

        const results = await mapPool(tasks, 3);
        expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(maxActive).toBeLessThanOrEqual(3);
    });

    it("returns empty for no tasks", async () => {
        await expect(mapPool([], 4)).resolves.toEqual([]);
    });
});
