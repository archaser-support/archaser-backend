import type { PrismaClient } from "@prisma/client";

const CATEGORY_CHANGE_TITLES = [
    "{{activities.fields.category_change}}",
    "{{activities.fields.category_change_to}}",
] as const;

const AUTOMATED_CATEGORY_KEY = "customers.values.category_automated";

function isAutomatedCategoryKey(value: unknown): boolean {
    return (
        typeof value === "string" &&
        (value === AUTOMATED_CATEGORY_KEY ||
            value === "Automated" ||
            value.toLowerCase().endsWith("_automated"))
    );
}

/**
 * Start of the current Automated pass on an open collection period.
 * A later Agent → Automated change is a new cycle; older delivered steps
 * belong to the previous pass and must not block step 1.
 */
export async function currentAutomatedCycleStartedAt(
    prisma: PrismaClient,
    collectionPeriodId: number
): Promise<Date | null> {
    const changes = await prisma.activity.findMany({
        where: {
            collection_period_id: collectionPeriodId,
            type: "Internal",
            title: { in: [...CATEGORY_CHANGE_TITLES] },
        },
        select: { created_at: true, title_params: true },
        orderBy: { created_at: "desc" },
        take: 30,
    });

    for (const row of changes) {
        const params = row.title_params as { newCategory?: unknown } | null;
        if (isAutomatedCategoryKey(params?.newCategory)) {
            return row.created_at;
        }
    }
    return null;
}
