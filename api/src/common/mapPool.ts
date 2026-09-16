/**
 * Run async task factories with a fixed concurrency cap.
 * Preserves result order matching the input task list.
 */
export async function mapPool<T>(
    tasks: Array<() => Promise<T>>,
    concurrency: number
): Promise<T[]> {
    if (tasks.length === 0) {
        return [];
    }
    const limit = Math.max(1, Math.min(concurrency, tasks.length));
    const results = new Array<T>(tasks.length);
    let nextIndex = 0;

    const workers = Array.from({ length: limit }, async () => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= tasks.length) {
                return;
            }
            results[index] = await tasks[index]();
        }
    });

    await Promise.all(workers);
    return results;
}
