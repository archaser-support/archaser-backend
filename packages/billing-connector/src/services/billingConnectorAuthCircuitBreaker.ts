import type { PrismaClient } from "@prisma/client";

/** Matches UI circuit-breaker banner (`consecutive_auth_failures >= 3`). */
export const AUTH_CIRCUIT_BREAKER_THRESHOLD = 3;

export type AuthCircuitBreakerResult = {
    consecutiveAuthFailures: number;
    syncDisabled: boolean;
};

/**
 * Increment auth failures; at threshold turn sync_enabled off (no separate status).
 */
export async function recordBillingConnectorAuthFailure(params: {
    prisma: PrismaClient;
    connectorId: number;
    now?: Date;
}): Promise<AuthCircuitBreakerResult> {
    const now = params.now ?? new Date();
    const current = await params.prisma.billingConnector.findUnique({
        where: { id: params.connectorId },
        select: { consecutive_auth_failures: true, sync_enabled: true },
    });
    if (!current) {
        return { consecutiveAuthFailures: 0, syncDisabled: false };
    }
    const nextFailures = current.consecutive_auth_failures + 1;
    const syncDisabled = nextFailures >= AUTH_CIRCUIT_BREAKER_THRESHOLD;
    await params.prisma.billingConnector.update({
        where: { id: params.connectorId },
        data: {
            consecutive_auth_failures: nextFailures,
            ...(syncDisabled ? { sync_enabled: false } : {}),
            modified_at: now,
        },
    });
    return { consecutiveAuthFailures: nextFailures, syncDisabled };
}

/** Clear auth failure counter after a successful connection test or sync. */
export async function clearBillingConnectorAuthFailures(params: {
    prisma: PrismaClient;
    connectorId: number;
    now?: Date;
}): Promise<void> {
    const now = params.now ?? new Date();
    await params.prisma.billingConnector.update({
        where: { id: params.connectorId },
        data: {
            consecutive_auth_failures: 0,
            modified_at: now,
        },
    });
}
