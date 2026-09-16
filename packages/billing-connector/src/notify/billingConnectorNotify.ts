import { smtpSend } from "./smtpSend";

export type SyncFailureStatus = "FAILED" | "PARTIAL" | "TIMEOUT";

export type NotifyOnFailureParams = {
    accountId: number;
    provider: string;
    status: SyncFailureStatus;
    errorMessage: string | null | undefined;
    executionId: string;
    completedAt: Date;
};

/** Max error message length included in notification email body. */
const ERROR_TRUNCATE_CHARS = 500;

/**
 * Default cooldown between failure notifications for the same account (60 min).
 * Override via `BILLING_CONNECTOR_ERROR_NOTIFY_COOLDOWN_MINUTES`.
 */
const DEFAULT_COOLDOWN_MINUTES = 60;

/**
 * Module-level in-memory cooldown store.
 * Keyed by accountId → last notification timestamp.
 * Intentionally module-scoped (like `ensureMongoConnection`) — survives for
 * the lifetime of the process, which is correct for a single-replica service.
 */
const lastNotifiedAt = new Map<number, Date>();

/** Exposed for testing only — reset the cooldown map between test cases. */
export function _resetCooldownMapForTests(): void {
    lastNotifiedAt.clear();
}

/**
 * Read the cooldown window in ms from env (BILLING_CONNECTOR_ERROR_NOTIFY_COOLDOWN_MINUTES).
 * Defaults to DEFAULT_COOLDOWN_MINUTES. Returns 0 on invalid/missing env.
 */
function getCooldownMs(): number {
    const raw = process.env.BILLING_CONNECTOR_ERROR_NOTIFY_COOLDOWN_MINUTES;
    if (raw == null || raw.trim() === "") {
        return DEFAULT_COOLDOWN_MINUTES * 60_000;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0
        ? parsed * 60_000
        : DEFAULT_COOLDOWN_MINUTES * 60_000;
}

/**
 * Return true if notifications are enabled for this process.
 * Enabled when `BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED=true`
 * OR `NODE_ENV=production`.
 */
function isEnabled(): boolean {
    return (
        process.env.BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED === "true" ||
        process.env.NODE_ENV === "production"
    );
}

/**
 * Parse `BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS` into a trimmed, de-duped list.
 * Returns an empty array when the env var is absent or blank.
 */
function getRecipients(): string[] {
    const raw = process.env.BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS ?? "";
    return [
        ...new Set(
            raw
                .split(",")
                .map((e) => e.trim())
                .filter((e) => e.length > 0)
        ),
    ];
}

function buildEmailBody(params: NotifyOnFailureParams): string {
    const errorSnippet = params.errorMessage
        ? params.errorMessage.slice(0, ERROR_TRUNCATE_CHARS) +
          (params.errorMessage.length > ERROR_TRUNCATE_CHARS ? "…" : "")
        : "(no error message recorded)";

    return `
<p>A billing connector sync finished with a non-SUCCESS status.</p>
<table cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:monospace;font-size:13px;">
  <tr><td style="padding-right:16px;color:#555">Account ID</td><td><strong>${params.accountId}</strong></td></tr>
  <tr><td style="padding-right:16px;color:#555">Provider</td><td>${params.provider}</td></tr>
  <tr><td style="padding-right:16px;color:#555">Status</td><td><strong style="color:#c0392b">${params.status}</strong></td></tr>
  <tr><td style="padding-right:16px;color:#555">Execution ID</td><td>${params.executionId}</td></tr>
  <tr><td style="padding-right:16px;color:#555">Completed at</td><td>${params.completedAt.toISOString()}</td></tr>
  <tr><td style="padding-right:16px;color:#555;vertical-align:top">Error</td><td><pre style="margin:0;white-space:pre-wrap">${errorSnippet}</pre></td></tr>
</table>
<p style="color:#777;font-size:12px;margin-top:16px">
  Check the Billing Connector dashboard in Grafana for details.<br>
  This notification is throttled per account — repeated failures within the cooldown window will not re-send.
</p>
`.trim();
}

/**
 * Send a failure notification email when a billing connector sync ends with a
 * non-SUCCESS terminal status.
 *
 * Rules:
 * - Only fires when enabled (see `isEnabled()`).
 * - Only fires when `BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS` is non-empty.
 * - Applies a per-account cooldown (default 60 min) to suppress repeated emails.
 * - Cooldown window is NOT consumed when SMTP is not configured (skipped send).
 * - Never throws — all errors are swallowed to avoid disturbing the sync lifecycle.
 */
export async function notifyOnSyncFailure(
    params: NotifyOnFailureParams
): Promise<void> {
    try {
        if (!isEnabled()) return;

        const recipients = getRecipients();
        if (recipients.length === 0) return;

        const now = new Date();
        const cooldownMs = getCooldownMs();
        const lastSent = lastNotifiedAt.get(params.accountId);
        if (lastSent && now.getTime() - lastSent.getTime() < cooldownMs) {
            return; // Within cooldown window — skip silently
        }

        const subject = `[ARchaser] Billing Connector Sync Failure — Account ${params.accountId} (${params.provider}) — ${params.status}`;
        const html = buildEmailBody(params);

        for (const toEmail of recipients) {
            const result = await smtpSend({ toEmail, subject, html });
            if (!result.skipped) {
                // Update cooldown only on a real send attempt (not SMTP-skip)
                lastNotifiedAt.set(params.accountId, now);
                break; // One successful send updates the cooldown; remaining recipients share the same timestamp
            }
        }

        // If the first recipient's send was skipped (SMTP not configured), try all;
        // but do NOT update the cooldown — skipped sends are infrastructure-level no-ops.
        // The above break ensures we only update once on a real send, so if all skip,
        // no cooldown is set (correct behaviour: don't suppress future sends when SMTP comes up).
    } catch {
        // Intentionally swallowed — notification is fire-and-forget
    }
}
