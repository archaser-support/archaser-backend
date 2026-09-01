import { Registry } from "prom-client";
import type { PrismaClient } from "@prisma/client";
import {
    resetSyncHistoryStoreForTests,
    useMemorySyncHistoryStoreForTests,
} from "@archaser/billing-connector";
import {
    getFrozenAccountIds,
    isAccountFrozen,
} from "../src/accountFreeze/frozenAccountResolver";
import {
    logFrozenAccountSkips,
    reportFrozenAccountSkips,
} from "../src/accountFreeze/frozenAccountObservability";
import { registerCronFrozenAccountMetrics } from "../src/accountFreeze/frozenAccountMetrics";

function mockPrisma(queryResults: {
    import?: number[];
    backfill?: number[];
}): PrismaClient {
    return {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
            const sql = strings.join(" ");
            if (sql.includes('"ImportJob"')) {
                return (queryResults.import ?? []).map((account_id) => ({
                    account_id,
                }));
            }
            if (sql.includes('"CreditAsOfBackfillJob"')) {
                return (queryResults.backfill ?? []).map((account_id) => ({
                    account_id,
                }));
            }
            return [];
        }),
    } as unknown as PrismaClient;
}

describe("getFrozenAccountIds", () => {
    const originalMongoUri = process.env.MONGODB_URI;

    afterEach(() => {
        if (originalMongoUri === undefined) {
            delete process.env.MONGODB_URI;
        } else {
            process.env.MONGODB_URI = originalMongoUri;
        }
        resetSyncHistoryStoreForTests();
    });

    it("includes account with ImportJob Processing", async () => {
        process.env.MONGODB_URI = "mongodb://test";
        const frozen = await getFrozenAccountIds({
            prisma: mockPrisma({ import: [101] }),
            listRunningSyncAccountIds: async () => [],
        });
        expect([...frozen]).toEqual([101]);
    });

    it("includes account with CreditAsOfBackfillJob running or paused", async () => {
        process.env.MONGODB_URI = "mongodb://test";
        const frozen = await getFrozenAccountIds({
            prisma: mockPrisma({ backfill: [202] }),
            listRunningSyncAccountIds: async () => [],
        });
        expect([...frozen]).toEqual([202]);
    });

    it("includes account with Mongo RUNNING sync execution", async () => {
        process.env.MONGODB_URI = "mongodb://test";
        const store = useMemorySyncHistoryStoreForTests();
        await store.createRunning({
            executionId: "exec-1",
            connectorId: 1,
            accountId: 303,
            provider: "PRIORITY",
            trigger: "manual",
            syncMode: "incremental",
        });

        const frozen = await getFrozenAccountIds({
            prisma: mockPrisma({}),
        });
        expect([...frozen]).toEqual([303]);
    });

    it("excludes account with no freeze signals", async () => {
        process.env.MONGODB_URI = "mongodb://test";
        const frozen = await getFrozenAccountIds({
            prisma: mockPrisma({}),
            listRunningSyncAccountIds: async () => [],
        });
        expect(frozen.size).toBe(0);
    });

    it("deduplicates when multiple signals apply to the same account", async () => {
        process.env.MONGODB_URI = "mongodb://test";
        const frozen = await getFrozenAccountIds({
            prisma: mockPrisma({ import: [404], backfill: [404] }),
            listRunningSyncAccountIds: async () => [404],
        });
        expect([...frozen]).toEqual([404]);
    });

    it("returns Postgres-only frozen accounts when MONGODB_URI is unset", async () => {
        delete process.env.MONGODB_URI;
        const frozen = await getFrozenAccountIds({
            prisma: mockPrisma({ import: [505], backfill: [506] }),
            listRunningSyncAccountIds: async () => {
                throw new Error("Mongo should not be called");
            },
        });
        expect([...frozen].sort((a, b) => a - b)).toEqual([505, 506]);
    });

    it("returns Postgres-only frozen accounts when Mongo lookup fails", async () => {
        process.env.MONGODB_URI = "mongodb://test";
        const frozen = await getFrozenAccountIds({
            prisma: mockPrisma({ import: [606] }),
            listRunningSyncAccountIds: async () => {
                throw new Error("Mongo unavailable");
            },
        });
        expect([...frozen]).toEqual([606]);
    });
});

describe("isAccountFrozen", () => {
    it("returns true when account is in the frozen set", async () => {
        const frozen = await isAccountFrozen(707, {
            prisma: mockPrisma({ import: [707] }),
            listRunningSyncAccountIds: async () => [],
        });
        expect(frozen).toBe(true);
    });

    it("returns false when account is not frozen", async () => {
        const frozen = await isAccountFrozen(808, {
            prisma: mockPrisma({}),
            listRunningSyncAccountIds: async () => [],
        });
        expect(frozen).toBe(false);
    });
});

describe("SyncHistoryStore.listRunningAccountIds", () => {
    afterEach(() => {
        resetSyncHistoryStoreForTests();
    });

    it("returns distinct account IDs for RUNNING executions only", async () => {
        const store = useMemorySyncHistoryStoreForTests();
        await store.createRunning({
            executionId: "run-a",
            connectorId: 1,
            accountId: 10,
            provider: "PRIORITY",
            trigger: "scheduled",
            syncMode: "incremental",
        });
        await store.createRunning({
            executionId: "run-b",
            connectorId: 2,
            accountId: 10,
            provider: "PRIORITY",
            trigger: "manual",
            syncMode: "backfill",
        });
        await store.createRunning({
            executionId: "run-c",
            connectorId: 3,
            accountId: 20,
            provider: "PRIORITY",
            trigger: "manual",
            syncMode: "incremental",
        });
        await store.completeIfRunning("run-c", { status: "SUCCESS" });

        const accountIds = await store.listRunningAccountIds();
        expect(accountIds.sort((a, b) => a - b)).toEqual([10]);
    });
});

describe("frozen account observability", () => {
    it("logs structured skip payload when skippedCount > 0", () => {
        const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
        logFrozenAccountSkips({
            jobName: "Process Overdue Invoices",
            frozenAccountIds: [1, 2],
            frozenCount: 2,
            skippedCount: 1,
        });
        expect(infoSpy).toHaveBeenCalledWith(
            expect.stringContaining("Process Overdue Invoices")
        );
        expect(infoSpy).toHaveBeenCalledWith(
            expect.stringContaining('"skippedCount":1')
        );
        infoSpy.mockRestore();
    });

    it("increments Prometheus counter when reportFrozenAccountSkips is invoked", async () => {
        const register = new Registry();
        const metrics = registerCronFrozenAccountMetrics(register);
        reportFrozenAccountSkips(metrics, {
            jobName: "Compute Customer Overdue Metrics",
            frozenAccountIds: [99],
            frozenCount: 1,
            skippedCount: 3,
        });
        const exposed = await register.metrics();
        expect(exposed).toContain(
            'archaser_cron_accounts_skipped_frozen_total{job_name="Compute Customer Overdue Metrics"} 3'
        );
    });
});
