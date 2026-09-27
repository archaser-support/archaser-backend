import {
    activateDuePendingCustomerPolicies,
    drainAsOfRewriteQueue,
    takeCustomerPolicyTrendSnapshots,
} from "@archaser/credit-insurance-domain";

/**
 * Future Nest CPT scheduler entrypoint.
 *
 * Deliberately unscheduled while the frontend Customer Policy Trend Daily
 * Snapshot cron owns this queue. Cutover must disable the frontend job before
 * registering this entrypoint in Nest/worker; never schedule both.
 */
export async function runCustomerPolicyTrendSnapshotsWithAsOfDrain(dependencies: {
    activatePending?: typeof activateDuePendingCustomerPolicies;
    takeSnapshots?: typeof takeCustomerPolicyTrendSnapshots;
    drainQueue?: typeof drainAsOfRewriteQueue;
} = {}): Promise<{
    pendingActivation: Awaited<
        ReturnType<typeof activateDuePendingCustomerPolicies>
    >;
    snapshot: Awaited<ReturnType<typeof takeCustomerPolicyTrendSnapshots>>;
    drain: Awaited<ReturnType<typeof drainAsOfRewriteQueue>>;
}> {
    const activatePending =
        dependencies.activatePending ?? activateDuePendingCustomerPolicies;
    const takeSnapshots =
        dependencies.takeSnapshots ?? takeCustomerPolicyTrendSnapshots;
    const drainQueue = dependencies.drainQueue ?? drainAsOfRewriteQueue;

    let pendingActivation:
        | Awaited<ReturnType<typeof activateDuePendingCustomerPolicies>>
        | undefined;
    let pendingActivationError: unknown;
    try {
        pendingActivation = await activatePending();
        if (pendingActivation.failures > 0) {
            pendingActivationError = new Error(
                `Pending policy activation completed with ${pendingActivation.failures} failures`
            );
        }
    } catch (error) {
        pendingActivationError = error;
    }

    let snapshot:
        | Awaited<ReturnType<typeof takeCustomerPolicyTrendSnapshots>>
        | undefined;
    let snapshotError: unknown;

    try {
        snapshot = await takeSnapshots();
    } catch (error) {
        snapshotError = error;
    }

    let drain:
        | Awaited<ReturnType<typeof drainAsOfRewriteQueue>>
        | undefined;
    let drainError: unknown;
    try {
        drain = await drainQueue();
        if (drain.failures > 0) {
            drainError = new Error(
                `As-of rewrite drain completed with ${drain.failures} failures`
            );
        }
    } catch (error) {
        drainError = error;
    }

    // Prefer today's snapshot error when both steps fail; the future scheduler
    // can log both around this domain entrypoint.
    if (snapshotError) {
        throw snapshotError;
    }
    if (pendingActivationError) {
        throw pendingActivationError;
    }
    if (drainError) {
        throw drainError;
    }
    return {
        pendingActivation: pendingActivation!,
        snapshot: snapshot!,
        drain: drain!,
    };
}
