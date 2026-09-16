import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Postgres tables that expose an integer `id` primary key and may be searched
 * by treating that id as text (substring / "contains").
 *
 * Values are fixed SQL identifiers — never pass user input here.
 */
const INT_ID_SEARCH_TABLE_SQL = {
    Account: Prisma.raw(`"Account"`),
    Customer: Prisma.raw(`"Customer"`),
    Invoice: Prisma.raw(`"Invoice"`),
    CustomerDispute: Prisma.raw(`"CustomerDispute"`),
} as const;

export type IntIdSearchTable = keyof typeof INT_ID_SEARCH_TABLE_SQL;

export type PrismaQueryRawClient = Pick<PrismaClient, "$queryRaw">;

/**
 * True when `searchTerm` is non-empty and all digits (safe for Int id text match).
 */
export function isDigitIdSearchTerm(searchTerm: string): boolean {
    return /^\d+$/.test(searchTerm.trim());
}

/**
 * Find primary-key ids whose decimal string contains `searchTerm`
 * (`CAST(id AS TEXT) LIKE '%' || term || '%'`).
 *
 * Prisma Int filters have no `contains`; treat id as a string via Postgres.
 */
export async function findIntIdsContainingAsText(
    prisma: PrismaQueryRawClient,
    table: IntIdSearchTable,
    searchTerm: string,
    options?: {
        /** When set, also require `account_id = accountId` on the same table. */
        accountId?: number;
    }
): Promise<number[]> {
    const term = searchTerm.trim();
    if (!isDigitIdSearchTerm(term)) {
        return [];
    }

    const pattern = `%${term}%`;
    const tableSql = INT_ID_SEARCH_TABLE_SQL[table];
    const accountId = options?.accountId;

    const rows =
        accountId == null
            ? await prisma.$queryRaw<Array<{ id: number | bigint }>>`
                  SELECT id FROM ${tableSql}
                  WHERE CAST(id AS TEXT) LIKE ${pattern}
              `
            : await prisma.$queryRaw<Array<{ id: number | bigint }>>`
                  SELECT id FROM ${tableSql}
                  WHERE CAST(id AS TEXT) LIKE ${pattern}
                    AND account_id = ${accountId}
              `;

    return rows.map((row) => Number(row.id));
}

/**
 * Prisma `where` fragment: `{ [field]: { in: ids } }`, or `undefined` when empty.
 */
export function intIdInWhere(
    ids: number[],
    field = "id"
): Record<string, unknown> | undefined {
    if (ids.length === 0) {
        return undefined;
    }
    return { [field]: { in: ids } };
}

/**
 * Resolve digit search against an Int id column (id treated as string / contains)
 * and append a Prisma OR clause when any rows match.
 */
export async function appendIntIdStringContainsOr(
    or: Record<string, unknown>[],
    prisma: PrismaQueryRawClient,
    table: IntIdSearchTable,
    searchTerm: string,
    options?: {
        field?: string;
        accountId?: number;
    }
): Promise<void> {
    if (!isDigitIdSearchTerm(searchTerm)) {
        return;
    }
    const ids = await findIntIdsContainingAsText(prisma, table, searchTerm, {
        accountId: options?.accountId,
    });
    const clause = intIdInWhere(ids, options?.field ?? "id");
    if (clause) {
        or.push(clause);
    }
}
