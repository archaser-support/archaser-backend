import { drainAsOfRewriteQueue } from "./asOfRewriteQueue";
import { takeCustomerPolicyTrendSnapshots } from "./customerPolicyTrendService";
export declare function runCustomerPolicyTrendSnapshotsWithAsOfDrain(dependencies?: {
    takeSnapshots?: typeof takeCustomerPolicyTrendSnapshots;
    drainQueue?: typeof drainAsOfRewriteQueue;
}): Promise<{
    snapshot: Awaited<ReturnType<typeof takeCustomerPolicyTrendSnapshots>>;
    drain: Awaited<ReturnType<typeof drainAsOfRewriteQueue>>;
}>;
