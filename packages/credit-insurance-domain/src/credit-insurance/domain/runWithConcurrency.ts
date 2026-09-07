/** Run async work over items with a fixed worker pool (order not guaranteed). */
export async function runWithConcurrency<T>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<void>
): Promise<void> {
    if (items.length === 0) {
        return;
    }
    const workerCount = Math.max(1, Math.min(limit, items.length));
    let cursor = 0;
    async function worker(): Promise<void> {
        for (;;) {
            const index = cursor++;
            if (index >= items.length) {
                return;
            }
            await fn(items[index]!);
        }
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

/** Like {@link runWithConcurrency} but collects results in input order. */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }
    const results: R[] = new Array(items.length);
    const workerCount = Math.max(1, Math.min(limit, items.length));
    let cursor = 0;
    async function worker(): Promise<void> {
        for (;;) {
            const index = cursor++;
            if (index >= items.length) {
                return;
            }
            results[index] = await fn(items[index]!, index);
        }
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

export function readEnvInt(
    name: string,
    defaultValue: number,
    min: number,
    max: number
): number {
    const raw = process.env[name];
    if (raw == null || raw.trim() === "") {
        return defaultValue;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
        return defaultValue;
    }
    return Math.max(min, Math.min(max, parsed));
}
