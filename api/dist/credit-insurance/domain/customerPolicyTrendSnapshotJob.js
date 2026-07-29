"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCustomerPolicyTrendSnapshotsWithAsOfDrain = runCustomerPolicyTrendSnapshotsWithAsOfDrain;
const asOfRewriteQueue_1 = require("./asOfRewriteQueue");
const customerPolicyTrendService_1 = require("./customerPolicyTrendService");
async function runCustomerPolicyTrendSnapshotsWithAsOfDrain(dependencies = {}) {
    const takeSnapshots = dependencies.takeSnapshots ?? customerPolicyTrendService_1.takeCustomerPolicyTrendSnapshots;
    const drainQueue = dependencies.drainQueue ?? asOfRewriteQueue_1.drainAsOfRewriteQueue;
    let snapshot;
    let snapshotError;
    try {
        snapshot = await takeSnapshots();
    }
    catch (error) {
        snapshotError = error;
    }
    let drain;
    let drainError;
    try {
        drain = await drainQueue();
        if (drain.failures > 0) {
            drainError = new Error(`As-of rewrite drain completed with ${drain.failures} failures`);
        }
    }
    catch (error) {
        drainError = error;
    }
    if (snapshotError) {
        throw snapshotError;
    }
    if (drainError) {
        throw drainError;
    }
    return { snapshot: snapshot, drain: drain };
}
//# sourceMappingURL=customerPolicyTrendSnapshotJob.js.map