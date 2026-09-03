/** Postgres prepared statements allow at most 32767 bind variables. */
export const PRISMA_IN_CHUNK = 10_000;

export async function findManyInChunks<TId, TRow>(
    ids: TId[],
    fetchChunk: (chunk: TId[]) => Promise<TRow[]>
): Promise<TRow[]> {
    if (ids.length === 0) {
        return [];
    }
    const rows: TRow[] = [];
    for (let i = 0; i < ids.length; i += PRISMA_IN_CHUNK) {
        const chunk = ids.slice(i, i + PRISMA_IN_CHUNK);
        rows.push(...(await fetchChunk(chunk)));
    }
    return rows;
}
