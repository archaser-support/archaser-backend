/**
 * Thrown when createRunning cannot insert because the account already has a
 * RUNNING sync-history document (partial unique index / store invariant).
 */
export class SyncAlreadyRunningError extends Error {
    readonly code = "SYNC_ALREADY_RUNNING" as const;
    readonly accountId: number;
    readonly existingExecutionId: string | null;

    constructor(accountId: number, existingExecutionId?: string | null) {
        const existing =
            existingExecutionId != null && existingExecutionId !== ""
                ? ` (execution ${existingExecutionId})`
                : "";
        super(`A sync is already running for account ${accountId}${existing}`);
        this.name = "SyncAlreadyRunningError";
        this.accountId = accountId;
        this.existingExecutionId = existingExecutionId ?? null;
    }
}

export function isSyncAlreadyRunningError(
    error: unknown
): error is SyncAlreadyRunningError {
    if (error instanceof SyncAlreadyRunningError) {
        return true;
    }
    if (typeof error !== "object" || error === null) {
        return false;
    }
    const candidate = error as {
        name?: string;
        code?: string;
        accountId?: number;
    };
    return (
        candidate.name === "SyncAlreadyRunningError" &&
        candidate.code === "SYNC_ALREADY_RUNNING" &&
        typeof candidate.accountId === "number"
    );
}

/** Mongo duplicate-key (E11000) for the one-RUNNING-per-account partial index. */
export function isAccountRunningDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false;
    }
    const candidate = error as {
        code?: number | string;
        message?: string;
        keyPattern?: Record<string, unknown>;
    };
    if (candidate.code !== 11000 && candidate.code !== "11000") {
        return false;
    }
    if (
        candidate.keyPattern &&
        "account_id" in candidate.keyPattern &&
        !("execution_id" in candidate.keyPattern)
    ) {
        return true;
    }
    return (
        typeof candidate.message === "string" &&
        candidate.message.includes(ACCOUNT_RUNNING_UNIQUE_INDEX_NAME)
    );
}

export const ACCOUNT_RUNNING_UNIQUE_INDEX_NAME = "uniq_account_running_sync";
