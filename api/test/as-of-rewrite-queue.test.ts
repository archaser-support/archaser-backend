import {
    coalesceCheckpointDate,
    drainAsOfRewriteQueue,
    enqueueAsOfRewriteInTransaction,
    isAdminBackfillBlockingDrain,
    isStaleProcessingUpdatedAt,
    mergeRewriteRange,
    REWRITE_QUEUE_STALE_PROCESSING_MS,
    resolveRewriteDrainStart,
} from "../src/credit-insurance/domain/asOfRewriteQueue";

function day(iso: string): Date {
    return new Date(`${iso}T00:00:00.000Z`);
}

function sqlText(strings: TemplateStringsArray): string {
    return strings.join("?");
}

describe("Nest as-of rewrite queue helpers", () => {
    it("coalesces windows and treats empty customer ids as whole-account", () => {
        const merged = mergeRewriteRange(
            {
                customerIds: [1, 3],
                fromDate: day("2026-03-10"),
                toDate: day("2026-03-20"),
            },
            {
                customerIds: [2, 3],
                fromDate: day("2026-03-01"),
                toDate: day("2026-04-01"),
            }
        );
        expect(merged.customerIds).toEqual([1, 2, 3]);
        expect(merged.fromDate).toEqual(day("2026-03-01"));
        expect(merged.toDate).toEqual(day("2026-04-01"));
        expect(
            mergeRewriteRange(merged, {
                customerIds: [],
                fromDate: day("2026-03-15"),
                toDate: day("2026-03-16"),
            }).customerIds
        ).toEqual([]);
    });

    it("resumes after checkpoint and guards stale checkpoints", () => {
        expect(
            resolveRewriteDrainStart(
                day("2026-07-01"),
                day("2026-07-03")
            )
        ).toEqual(day("2026-07-04"));
        expect(
            resolveRewriteDrainStart(
                day("2026-07-10"),
                day("2026-07-01")
            )
        ).toEqual(day("2026-07-10"));
    });

    it("resets checkpoint when coalesce widens backward", () => {
        expect(
            coalesceCheckpointDate(
                day("2026-07-10"),
                day("2026-07-01"),
                day("2026-07-15")
            )
        ).toBeNull();
        expect(
            coalesceCheckpointDate(
                day("2026-07-01"),
                day("2026-07-01"),
                day("2026-07-05")
            )
        ).toEqual(day("2026-07-05"));
    });

    it("uses a 60-minute reclaim threshold and recognizes blocking backfills", () => {
        const now = new Date("2026-07-27T12:00:00.000Z");
        expect(
            isStaleProcessingUpdatedAt(
                new Date(
                    now.getTime() - REWRITE_QUEUE_STALE_PROCESSING_MS
                ),
                now
            )
        ).toBe(true);
        expect(
            isStaleProcessingUpdatedAt(
                new Date(now.getTime() - 30 * 60 * 1000),
                now
            )
        ).toBe(false);
        expect(isAdminBackfillBlockingDrain("running")).toBe(true);
        expect(isAdminBackfillBlockingDrain("paused")).toBe(true);
        expect(isAdminBackfillBlockingDrain("complete")).toBe(false);
    });

    it("clears checkpoint in the persisted coalesce update", async () => {
        const executeRaw = jest.fn(async (..._args: unknown[]) => 1);
        const queryRaw = jest.fn(async () => [
            {
                id: 3n,
                from_date: day("2026-07-10"),
                to_date: day("2026-07-20"),
                customer_ids: [1],
                checkpoint_date: day("2026-07-15"),
            },
        ]);

        await enqueueAsOfRewriteInTransaction(
            { $queryRaw: queryRaw, $executeRaw: executeRaw } as never,
            {
                accountId: 42,
                customerIds: [1],
                fromDate: day("2026-07-01"),
                toDate: day("2026-07-12"),
            }
        );

        const update = executeRaw.mock.calls[0];
        expect(sqlText(update[0] as unknown as TemplateStringsArray)).toContain(
            "checkpoint_date ="
        );
        expect(update[4]).toBeNull();
    });
});

describe("Nest drainAsOfRewriteQueue", () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    let executeRaw: jest.Mock;
    let queryRaw: jest.Mock;
    let syncCpt: jest.Mock;
    let takeDashboard: jest.Mock;

    beforeEach(() => {
        executeRaw = jest.fn(async (strings: TemplateStringsArray) => {
            const sql = sqlText(strings);
            return sql.includes("status = 'processing'") &&
                sql.includes("AND status = 'pending'")
                ? 1
                : 1;
        });
        queryRaw = jest.fn(async () => []);
        syncCpt = jest.fn(async () => undefined);
        takeDashboard = jest.fn(async () => undefined);
    });

    function pending(overrides: Record<string, unknown> = {}) {
        return {
            id: 7n,
            account_id: 42,
            from_date: day("2026-07-01"),
            to_date: day("2026-07-04"),
            customer_ids: [] as number[],
            checkpoint_date: null,
            ...overrides,
        };
    }

    async function drain() {
        return drainAsOfRewriteQueue({
            dbClient: { $executeRaw: executeRaw, $queryRaw: queryRaw } as never,
            now,
            writers: {
                syncCustomerPolicyTrendSnapshotForAccount: syncCpt,
                takeCreditDashboardDailySnapshotsForAccount: takeDashboard,
            },
        });
    }

    it("reclaims stale rows before selecting work", async () => {
        await drain();
        const reclaim = executeRaw.mock.calls[0];
        expect(
            sqlText(reclaim[0] as unknown as TemplateStringsArray)
        ).toContain("status = 'processing'");
        expect((reclaim[2] as Date).getTime()).toBe(
            now.getTime() - REWRITE_QUEUE_STALE_PROCESSING_MS
        );
    });

    it("resumes after checkpoint and checkpoints each completed day", async () => {
        queryRaw
            .mockResolvedValueOnce([
                pending({ checkpoint_date: day("2026-07-02") }),
            ])
            .mockResolvedValueOnce([]);

        const result = await drain();

        expect(result).toEqual({
            itemsProcessed: 1,
            daysRewritten: 2,
            failures: 0,
            skippedForBackfill: 0,
        });
        expect(
            syncCpt.mock.calls.map((call) =>
                call[1].snapshotDate.toISOString().slice(0, 10)
            )
        ).toEqual(["2026-07-03", "2026-07-04"]);
        expect(
            executeRaw.mock.calls.filter((call) =>
                sqlText(
                    call[0] as unknown as TemplateStringsArray
                ).includes("checkpoint_date =")
            )
        ).toHaveLength(2);
    });

    it("keeps failed work pending with checkpoint, attempt, and error", async () => {
        queryRaw
            .mockResolvedValueOnce([
                pending({
                    to_date: day("2026-07-03"),
                    customer_ids: [11],
                }),
            ])
            .mockResolvedValueOnce([]);
        syncCpt
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("writer blew up"));

        const result = await drain();

        expect(result).toMatchObject({
            itemsProcessed: 0,
            daysRewritten: 1,
            failures: 1,
        });
        const failureUpdate = executeRaw.mock.calls.find((call) =>
            sqlText(call[0] as unknown as TemplateStringsArray).includes(
                "attempts = attempts + 1"
            )
        );
        expect(failureUpdate).toBeDefined();
        expect(
            sqlText(
                failureUpdate![0] as unknown as TemplateStringsArray
            )
        ).toContain("status = 'pending'");
    });

    it("leaves accounts with running backfill pending without failing", async () => {
        queryRaw
            .mockResolvedValueOnce([pending()])
            .mockResolvedValueOnce([{ account_id: 42 }]);

        const result = await drain();

        expect(result).toEqual({
            itemsProcessed: 0,
            daysRewritten: 0,
            failures: 0,
            skippedForBackfill: 1,
        });
        expect(syncCpt).not.toHaveBeenCalled();
        expect(takeDashboard).not.toHaveBeenCalled();
        expect(
            executeRaw.mock.calls.some((call) => {
                const sql = sqlText(
                    call[0] as unknown as TemplateStringsArray
                );
                return (
                    sql.includes("status = 'processing'") &&
                    sql.includes("AND status = 'pending'")
                );
            })
        ).toBe(false);
    });
});
