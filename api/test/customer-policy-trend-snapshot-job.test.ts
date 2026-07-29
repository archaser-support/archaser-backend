import { runCustomerPolicyTrendSnapshotsWithAsOfDrain } from "../src/credit-insurance/domain/customerPolicyTrendSnapshotJob";

const snapshotOk = {
    rowsUpserted: 2,
    accountsProcessed: 1,
    gapFillWarnings: [],
};
const drainOk = {
    itemsProcessed: 1,
    daysRewritten: 3,
    failures: 0,
    skippedForBackfill: 0,
};

describe("Nest CPT snapshot entrypoint with as-of drain", () => {
    it("invokes drain after a successful snapshot run", async () => {
        const takeSnapshots = jest.fn().mockResolvedValue(snapshotOk);
        const drainQueue = jest.fn().mockResolvedValue(drainOk);

        await expect(
            runCustomerPolicyTrendSnapshotsWithAsOfDrain({
                takeSnapshots,
                drainQueue,
            })
        ).resolves.toEqual({ snapshot: snapshotOk, drain: drainOk });
        expect(takeSnapshots).toHaveBeenCalledTimes(1);
        expect(drainQueue).toHaveBeenCalledTimes(1);
    });

    it("still invokes drain when today's snapshot run fails", async () => {
        const takeSnapshots = jest
            .fn()
            .mockRejectedValue(new Error("today snapshot failed"));
        const drainQueue = jest.fn().mockResolvedValue(drainOk);

        await expect(
            runCustomerPolicyTrendSnapshotsWithAsOfDrain({
                takeSnapshots,
                drainQueue,
            })
        ).rejects.toThrow("today snapshot failed");
        expect(drainQueue).toHaveBeenCalledTimes(1);
    });

    it("fails when drain reports unclean completion", async () => {
        await expect(
            runCustomerPolicyTrendSnapshotsWithAsOfDrain({
                takeSnapshots: jest.fn().mockResolvedValue(snapshotOk),
                drainQueue: jest.fn().mockResolvedValue({
                    ...drainOk,
                    failures: 2,
                }),
            })
        ).rejects.toThrow("2 failures");
    });

    it("does not fail for admin-backfill skips alone", async () => {
        await expect(
            runCustomerPolicyTrendSnapshotsWithAsOfDrain({
                takeSnapshots: jest.fn().mockResolvedValue(snapshotOk),
                drainQueue: jest.fn().mockResolvedValue({
                    ...drainOk,
                    itemsProcessed: 0,
                    daysRewritten: 0,
                    skippedForBackfill: 4,
                }),
            })
        ).resolves.toMatchObject({
            drain: { failures: 0, skippedForBackfill: 4 },
        });
    });
});
