import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { BillingConnectorApiService } from "../src/billing-connector/billing-connector.service";
import {
    allEnabledEntitiesPreviewPassed,
    resetConnectorSyncCancelRegistryForTests,
    resetConnectorSyncRuntimeForTests,
} from "@archaser/billing-connector";

jest.mock("@archaser/billing-connector", () => {
    const actual = jest.requireActual("@archaser/billing-connector");
    return {
        ...actual,
        runInProcessSync: jest.fn(),
        runPreviewSync: jest.fn(),
        fetchPriorityEntitySetCatalog: jest.fn(),
        decryptCredentials: jest.fn(),
        encryptCredentials: jest.fn((value: unknown) => JSON.stringify(value)),
        isBillingConnectorEncryptionConfigured: jest.fn(() => true),
        testBillingConnectorConnection: jest.fn(),
        discoverConnectorFields: jest.fn(),
    };
});

const billingConnector = jest.requireMock("@archaser/billing-connector") as {
    runInProcessSync: jest.Mock;
    runPreviewSync: jest.Mock;
};

function user(accountId: number) {
    return { sub: "user-1", username: "user", account_id: accountId };
}

function accessScope(accountId: number, allowed = true) {
    return {
        resolveUserInfo: jest.fn().mockResolvedValue({
            userId: "user-1",
            accountId,
            role: "Admin",
        }),
        getEffectiveAccountId: jest.fn().mockReturnValue(accountId),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
        hasPermission: jest.fn().mockResolvedValue(allowed),
    };
}

describe("billing connector Nest API", () => {
    beforeEach(() => {
        resetConnectorSyncCancelRegistryForTests();
        resetConnectorSyncRuntimeForTests();
        jest.clearAllMocks();
    });

    it("rejects a caller without billing-connector permission", async () => {
        const service = new BillingConnectorApiService(
            {} as never,
            accessScope(42, false) as never
        );
        await expect(
            service.getConfig(user(42), 42)
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("rejects cross-account access unless super-admin", async () => {
        const service = new BillingConnectorApiService(
            {} as never,
            accessScope(42, true) as never
        );
        await expect(
            service.getConfig(user(42), 99)
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("blocks first backfill until every enabled entity has a passing preview", async () => {
        const db = {
            billingConnector: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 1,
                    account_id: 42,
                    enabled_entities: ["Customer", "Invoice"],
                    preview_passes: {
                        Customer: {
                            passed: true,
                            completed_at: "2026-08-04T00:00:00.000Z",
                        },
                    },
                    backfill_started_at: null,
                    sync_mode: "BACKFILL",
                    backfill_start_date: null,
                    include_older_open_invoices: true,
                    skip_reporting_breach_on_backfill: false,
                }),
            },
        };
        const service = new BillingConnectorApiService(
            db as never,
            accessScope(42, true) as never
        );
        await expect(
            service.runSync(user(42), 42, "backfill")
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(billingConnector.runInProcessSync).not.toHaveBeenCalled();
    });

    it("allows backfill when preview is bypassed after lock or incremental mode", async () => {
        billingConnector.runInProcessSync.mockResolvedValue({
            ok: true,
            cancelled: false,
            accountId: 42,
            provider: "PRIORITY",
            stats: {},
            entity_stats: {},
            message: "ok",
        });
        const db = {
            billingConnector: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 1,
                    account_id: 42,
                    enabled_entities: ["Customer"],
                    preview_passes: {},
                    backfill_started_at: new Date("2026-08-01T00:00:00.000Z"),
                    sync_mode: "INCREMENTAL",
                    backfill_start_date: null,
                    include_older_open_invoices: true,
                    skip_reporting_breach_on_backfill: false,
                }),
            },
        };
        const service = new BillingConnectorApiService(
            db as never,
            accessScope(42, true) as never
        );
        const result = await service.runSync(user(42), 42, "backfill");
        expect(billingConnector.runInProcessSync).toHaveBeenCalled();
        expect(result.result.status).toBe("SUCCESS");
    });

    it("requires preview, backfill, or incremental mode", async () => {
        const service = new BillingConnectorApiService(
            {} as never,
            accessScope(42, true) as never
        );
        await expect(
            service.runSync(user(42), 42, "nope")
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("cancels the in-process running sync for this account", async () => {
        const {
            registerRunningSync,
            isConnectorSyncCancelRequested,
        } = jest.requireActual("@archaser/billing-connector") as typeof import("@archaser/billing-connector");
        registerRunningSync({
            accountId: 42,
            executionId: "exec-1",
            startedAt: new Date(),
            mode: "backfill",
            trigger: "backfill",
        });
        const service = new BillingConnectorApiService(
            {} as never,
            accessScope(42, true) as never
        );
        const result = await service.cancelSync(user(42), 42);
        expect(result.result).toEqual({
            cancelled: true,
            execution_id: "exec-1",
        });
        expect(isConnectorSyncCancelRequested("exec-1")).toBe(true);
    });
});

describe("preview pass helper used by the Nest gate", () => {
    it("requires every enabled entity to have passed:true", () => {
        expect(
            allEnabledEntitiesPreviewPassed(["Customer", "Invoice"], {
                Customer: {
                    passed: true,
                    completed_at: "2026-08-04T00:00:00.000Z",
                },
            })
        ).toBe(false);
        expect(
            allEnabledEntitiesPreviewPassed(["Customer"], {
                Customer: {
                    passed: true,
                    completed_at: "2026-08-04T00:00:00.000Z",
                },
            })
        ).toBe(true);
    });
});
