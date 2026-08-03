import { drainAsOfRewriteQueue } from "./asOfRewriteQueue";
import { takeCustomerPolicyTrendSnapshots } from "./customerPolicyTrendService";
/**
 * Future Nest CPT scheduler entrypoint.
 *
 * Deliberately unscheduled while the frontend Customer Policy Trend Daily
 * Snapshot cron owns this queue. Cutover must disable the frontend job before
 * registering this entrypoint in Nest/worker; never schedule both.
 */
export declare function runCustomerPolicyTrendSnapshotsWithAsOfDrain(dependencies?: {
    takeSnapshots?: typeof takeCustomerPolicyTrendSnapshots;
    drainQueue?: typeof drainAsOfRewriteQueue;
}): Promise<{
    snapshot: Awaited<ReturnType<typeof takeCustomerPolicyTrendSnapshots>>;
    drain: Awaited<ReturnType<typeof drainAsOfRewriteQueue>>;
}>;
