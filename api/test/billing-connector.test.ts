import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { BillingConnectorApiService } from "../src/billing-connector/billing-connector.service";
import {
    ACCOUNT_10149_EXTENSION_KEY,
    allEnabledEntitiesPreviewPassed,
} from "@archaser/billing-connector";
import { resetConnectorSyncCancelRegistryForTests } from "../../packages/billing-connector/src/sync/connectorSyncCancelRegistry";
import { resetConnectorSyncRuntimeForTests } from "../../packages/billing-connector/src/sync/connectorSyncRuntime";

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
        createRunningExecution: jest.fn().mockResolvedValue(null),
        completeExecution: jest.fn().mockResolvedValue(null),
        markExecutionCancelled: jest.fn().mockResolvedValue(null),
        listExecutionsForAccount: jest.fn().mockResolvedValue([]),
        sweepStaleRunning: jest.fn().mockResolvedValue(0),
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

const CONNECTOR_NOW = new Date("2026-08-01T00:00:00.000Z");

function connectorRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        account_id: 42,
        provider: "PRIORITY",
        status: "ACTIVE",
        base_url: "https://erp.example.com",
        auth_type: "API_KEY",
        credentials_encrypted: "enc",
        sync_enabled: true,
        sync_cron_expression: "0 */6 * * *",
        sync_mode: "BACKFILL",
        enabled_entities: ["Invoice"],
        sync_overlap_minutes: 5,
        consecutive_auth_failures: 0,
        backfill_started_at: null,
        backfill_start_date: null,
        include_older_open_invoices: true,
        skip_reporting_breach_on_backfill: false,
        pull_filters: {},
        entity_sets: {},
        entity_set_catalog: null,
        entity_set_catalog_fetched_at: null,
        preview_passes: {},
        extension_key: null,
        extension_config: null,
        last_connection_test_at: null,
        last_connection_error: null,
        created_at: CONNECTOR_NOW,
        modified_at: CONNECTOR_NOW,
        ConnectorSyncState: [],
        ...overrides,
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

    it("starts backfill in the background and returns RUNNING immediately", async () => {
        let resolveSync: ((value: unknown) => void) | undefined;
        billingConnector.runInProcessSync.mockReturnValue(
            new Promise((resolve) => {
                resolveSync = resolve;
            })
        );
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
        expect(result.result.status).toBe("RUNNING");
        expect(result.result.accepted).toBe(true);
        expect(result.result.execution_id).toEqual(expect.any(String));
        await Promise.resolve();
        expect(billingConnector.runInProcessSync).toHaveBeenCalled();
        resolveSync?.({
            ok: true,
            cancelled: false,
            accountId: 42,
            provider: "PRIORITY",
            stats: {},
            entity_stats: {},
            message: "ok",
        });
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

    it("returns extension_key and extension_config on get", async () => {
        const db = {
            billingConnector: {
                findUnique: jest.fn().mockResolvedValue(
                    connectorRow({
                        extension_key: ACCOUNT_10149_EXTENSION_KEY,
                        extension_config: {},
                    })
                ),
            },
        };
        const service = new BillingConnectorApiService(
            db as never,
            accessScope(42, true) as never
        );
        const result = await service.getConfig(user(42), 42);
        expect(result.config.extension_key).toBe(ACCOUNT_10149_EXTENSION_KEY);
        expect(result.config.extension_config).toEqual({});
    });

    it("persists a registered extension_key on upsert and returns it", async () => {
        const existing = connectorRow();
        const updated = connectorRow({
            extension_key: ACCOUNT_10149_EXTENSION_KEY,
            extension_config: {},
        });
        const db = {
            billingConnector: {
                findUnique: jest.fn().mockResolvedValue(existing),
                update: jest.fn().mockResolvedValue(updated),
            },
        };
        const service = new BillingConnectorApiService(
            db as never,
            accessScope(42, true) as never
        );
        const result = await service.upsertConfig(user(42), 42, {
            extension_key: ACCOUNT_10149_EXTENSION_KEY,
            extension_config: {},
        });
        expect(db.billingConnector.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    extension_key: ACCOUNT_10149_EXTENSION_KEY,
                    extension_config: {},
                }),
            })
        );
        expect(result.config.extension_key).toBe(ACCOUNT_10149_EXTENSION_KEY);
        expect(result.config.extension_config).toEqual({});
    });

    it("clears extension_key when upsert sends null", async () => {
        const existing = connectorRow({
            extension_key: ACCOUNT_10149_EXTENSION_KEY,
            extension_config: {},
        });
        const updated = connectorRow({
            extension_key: null,
            extension_config: null,
        });
        const db = {
            billingConnector: {
                findUnique: jest.fn().mockResolvedValue(existing),
                update: jest.fn().mockResolvedValue(updated),
            },
        };
        const service = new BillingConnectorApiService(
            db as never,
            accessScope(42, true) as never
        );
        const result = await service.upsertConfig(user(42), 42, {
            extension_key: null,
            extension_config: null,
        });
        expect(db.billingConnector.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    extension_key: null,
                    extension_config: null,
                }),
            })
        );
        expect(result.config.extension_key).toBeNull();
        expect(result.config.extension_config).toBeNull();
    });

    it("rejects an unknown extension_key on upsert", async () => {
        const db = {
            billingConnector: {
                findUnique: jest.fn().mockResolvedValue(connectorRow()),
                update: jest.fn(),
            },
        };
        const service = new BillingConnectorApiService(
            db as never,
            accessScope(42, true) as never
        );
        await expect(
            service.upsertConfig(user(42), 42, {
                extension_key: "not_a_real_extension",
            })
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(db.billingConnector.update).not.toHaveBeenCalled();
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
