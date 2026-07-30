import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

describe("CustomerPolicyTrend effective limit defaults", () => {
    it("stores base approved as effective limit when account has no top-up", () => {
        // Regression: nulling effective_approved_limit broke Portfolio Health util.
        const source = readFileSync(
            resolve(
                __dirname,
                "../src/credit-insurance/domain/customerPolicyTrendService.ts"
            ),
            "utf8"
        );
        expect(source).not.toMatch(
            /if\s*\(\s*!accountHasTopUp\s*\)\s*\{[^}]*effectiveApprovedLimit\s*=\s*null/s
        );
        expect(source).toContain(
            "cp.approved_limit != null\n                ? new Prisma.Decimal(cp.approved_limit)"
        );
    });
});
