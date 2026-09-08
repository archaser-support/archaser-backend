// Mock smtpSend before importing the module under test
jest.mock("../src/notify/smtpSend", () => ({
    smtpSend: jest.fn().mockResolvedValue({ messageId: "mock-msg-id" }),
}));

// ---- Module under test ----
import {
    notifyOnSyncFailure,
    _resetCooldownMapForTests,
} from "../src/notify/billingConnectorNotify";

import { smtpSend } from "../src/notify/smtpSend";

const mockSmtpSend = smtpSend as jest.MockedFunction<typeof smtpSend>;

const BASE_PARAMS = {
    accountId: 42,
    provider: "Priority",
    status: "FAILED" as const,
    errorMessage: "API returned 401",
    executionId: "exec-abc-123",
    completedAt: new Date("2025-01-01T12:00:00Z"),
};

function setEnv(overrides: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(overrides)) {
        if (v === undefined) {
            delete process.env[k];
        } else {
            process.env[k] = v;
        }
    }
}

describe("notifyOnSyncFailure", () => {
    beforeEach(() => {
        _resetCooldownMapForTests();
        mockSmtpSend.mockResolvedValue({ messageId: "mock-msg-id" });
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2025-01-01T12:00:00Z"));
        // Default: enabled + at least one recipient
        setEnv({
            BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED: "true",
            BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS: "ops@example.com",
            NODE_ENV: "development",
            BILLING_CONNECTOR_ERROR_NOTIFY_COOLDOWN_MINUTES: undefined,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
        setEnv({
            BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED: undefined,
            BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS: undefined,
            NODE_ENV: undefined,
            BILLING_CONNECTOR_ERROR_NOTIFY_COOLDOWN_MINUTES: undefined,
        });
    });

    it("sends an email when enabled and recipients are configured", async () => {
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(1);
        const call = mockSmtpSend.mock.calls[0][0];
        expect(call.toEmail).toBe("ops@example.com");
        expect(call.subject).toContain("Account 42");
        expect(call.subject).toContain("Priority");
        expect(call.subject).toContain("FAILED");
    });

    it("does NOT send when BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED is absent and NODE_ENV is not production", async () => {
        setEnv({
            BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED: undefined,
            NODE_ENV: "development",
        });
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).not.toHaveBeenCalled();
    });

    it("sends when NODE_ENV=production even without the explicit flag", async () => {
        setEnv({
            BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED: undefined,
            NODE_ENV: "production",
        });
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(1);
    });

    it("does NOT send when recipient list is empty", async () => {
        setEnv({ BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS: "" });
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).not.toHaveBeenCalled();
    });

    it("does NOT send when recipient env var is missing", async () => {
        setEnv({ BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS: undefined });
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).not.toHaveBeenCalled();
    });

    it("skips a second call for the same account within the cooldown window", async () => {
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(1);

        // Advance 30 min — still within default 60-min cooldown
        jest.advanceTimersByTime(30 * 60 * 1000);
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(1); // still 1
    });

    it("sends again after cooldown expires", async () => {
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(1);

        // Advance past the 60-min default
        jest.advanceTimersByTime(61 * 60 * 1000);
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(2);
    });

    it("respects BILLING_CONNECTOR_ERROR_NOTIFY_COOLDOWN_MINUTES override", async () => {
        setEnv({ BILLING_CONNECTOR_ERROR_NOTIFY_COOLDOWN_MINUTES: "5" });

        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(1);

        // 4 min — still within 5-min custom cooldown
        jest.advanceTimersByTime(4 * 60 * 1000);
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(1);

        // 2 more min — now past 5 min
        jest.advanceTimersByTime(2 * 60 * 1000);
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(2);
    });

    it("does NOT update cooldown when SMTP returns skipped (not configured)", async () => {
        mockSmtpSend.mockResolvedValue({
            messageId: "smtp-not-configured",
            skipped: true,
        });

        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(1);

        // A second call immediately after should also attempt to send (cooldown not set)
        await notifyOnSyncFailure(BASE_PARAMS);
        expect(mockSmtpSend).toHaveBeenCalledTimes(2);
    });

    it("cooldown is per account — different accounts are independent", async () => {
        await notifyOnSyncFailure(BASE_PARAMS); // account 42
        await notifyOnSyncFailure({ ...BASE_PARAMS, accountId: 99 }); // account 99
        expect(mockSmtpSend).toHaveBeenCalledTimes(2);

        // Within cooldown for account 42 — but account 100 is new
        await notifyOnSyncFailure(BASE_PARAMS); // account 42 — within cooldown
        await notifyOnSyncFailure({ ...BASE_PARAMS, accountId: 100 }); // account 100 — new
        expect(mockSmtpSend).toHaveBeenCalledTimes(3); // only account-100 call goes through
    });

    it("truncates long error messages to 500 chars in the email body", async () => {
        const longError = "x".repeat(600);
        await notifyOnSyncFailure({ ...BASE_PARAMS, errorMessage: longError });
        expect(mockSmtpSend).toHaveBeenCalledTimes(1);
        const html = mockSmtpSend.mock.calls[0][0].html;
        expect(html).toContain("x".repeat(500));
        expect(html).not.toContain("x".repeat(501));
        expect(html).toContain("…");
    });

    it("includes all key fields in the email body", async () => {
        await notifyOnSyncFailure(BASE_PARAMS);
        const html = mockSmtpSend.mock.calls[0][0].html;
        expect(html).toContain("42"); // accountId
        expect(html).toContain("Priority"); // provider
        expect(html).toContain("FAILED"); // status
        expect(html).toContain("exec-abc-123"); // executionId
        expect(html).toContain("API returned 401"); // errorMessage
    });

    it("never throws even if smtpSend rejects", async () => {
        mockSmtpSend.mockRejectedValue(new Error("network timeout"));
        await expect(notifyOnSyncFailure(BASE_PARAMS)).resolves.toBeUndefined();
    });
});
