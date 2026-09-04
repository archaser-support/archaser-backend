import { type Job, type Queue } from "bullmq";

/**
 * Remove a Generate BullMQ job even when left `active` by a dead worker.
 * Required for pause/retry/reclaim after dev restarts or SIGINT.
 */
export async function forceRemoveCreditAsOfBackfillBullJob(
    queue: Queue,
    jobId: string
): Promise<{ removed: boolean; priorState?: string; note?: string }> {
    const job = await queue.getJob(jobId);
    if (!job) {
        return { removed: true };
    }

    const priorState = await job.getState();
    try {
        await job.remove();
        return { removed: true, priorState };
    } catch (firstError) {
        if (priorState !== "active") {
            return {
                removed: false,
                priorState,
                note:
                    firstError instanceof Error
                        ? firstError.message
                        : String(firstError),
            };
        }

        const client = await queue.client;
        const prefix = queue.opts.prefix ?? "bull";
        await client.del(`${prefix}:${queue.name}:${jobId}:lock`);

        try {
            await job.remove();
            return { removed: true, priorState, note: "lock cleared" };
        } catch (secondError) {
            try {
                await job.moveToFailed(
                    new Error("Stale Generate worker job replaced"),
                    "0",
                    true
                );
                await job.remove();
                return {
                    removed: true,
                    priorState,
                    note: "moved to failed then removed",
                };
            } catch (thirdError) {
                return {
                    removed: false,
                    priorState,
                    note:
                        thirdError instanceof Error
                            ? thirdError.message
                            : String(thirdError),
                };
            }
        }
    }
}

export async function requeueCreditAsOfBackfillBullJob(
    queue: Queue,
    jobId: string,
    accountId: number
): Promise<Job> {
    const removal = await forceRemoveCreditAsOfBackfillBullJob(queue, jobId);
    if (!removal.removed) {
        throw new Error(
            `Could not replace BullMQ job ${jobId} (${removal.priorState ?? "unknown"}): ${removal.note ?? "remove failed"}`
        );
    }
    return queue.add(
        "credit-asof-backfill",
        { accountId },
        {
            jobId,
            removeOnComplete: 100,
            removeOnFail: 200,
        }
    );
}
