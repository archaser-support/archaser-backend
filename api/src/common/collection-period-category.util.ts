/**
 * Shared collection-period category updates for API paths that must stay in
 * sync with CollectionPeriodService / cron moveCollectionToNextCategory.
 */

export const COLLECTION_CATEGORIES = [
    "Automated",
    "Promise_to_pay",
    "Dispute",
    "Agent",
    "Legal",
] as const;

export type CollectionCategory = (typeof COLLECTION_CATEGORIES)[number];

export function categoryTranslationKey(category: string): string {
    return `customers.values.category_${category
        .toLowerCase()
        .replace(/[_\s]/g, "_")}`;
}

const UUID_LIKE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPersistedUserId(userId: string | null | undefined): userId is string {
    return typeof userId === "string" && UUID_LIKE.test(userId);
}
export type CategoryChangeDb = {
    customerCollectionPeriod: {
        update: (args: {
            where: { id: number };
            data: Record<string, unknown>;
        }) => Promise<unknown>;
    };
    activity: {
        updateMany: (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
        }) => Promise<unknown>;
        deleteMany: (args: {
            where: Record<string, unknown>;
        }) => Promise<unknown>;
        create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    };
    customerDispute: {
        count: (args: { where: Record<string, unknown> }) => Promise<number>;
        findMany?: (args: {
            where: Record<string, unknown>;
            select?: Record<string, unknown>;
        }) => Promise<unknown[]>;
    };
    customerCollectionPeriodFind?: never;
};

export type ApplyCategoryChangeParams = {
    collectionPeriodId: number;
    customerId: number;
    accountId: number;
    currentCategory: string | null | undefined;
    nextCategory: CollectionCategory | string;
    userId?: string | null;
    /** When true, activity is treated as a manual agent change. */
    isManual?: boolean;
    resetStepToZero?: boolean;
};

/**
 * Apply a category change (period fields + cancel Scheduled/Paused activities
 * leaving Automated/PTP + category-change timeline activity).
 * No-ops when current === next.
 */
export async function applyCollectionPeriodCategoryChange(
    tx: CategoryChangeDb,
    params: ApplyCategoryChangeParams
): Promise<boolean> {
    const {
        collectionPeriodId,
        customerId,
        accountId,
        currentCategory,
        nextCategory,
        userId,
        isManual = false,
        resetStepToZero = false,
    } = params;

    const previousCategory = currentCategory ?? null;
    if (previousCategory === nextCategory) {
        return false;
    }

    const updateData: Record<string, unknown> = {
        current_category: nextCategory,
        previous_category: previousCategory,
        next_category: null,
        next_category_date: null,
        modified_at: new Date(),
    };
    if (isPersistedUserId(userId)) {
        updateData.modified_by = userId;
    }

    if (nextCategory === "Automated") {
        if (
            previousCategory === "Promise_to_pay" ||
            previousCategory === "Dispute"
        ) {
            updateData.is_last_automated_step_delivered = false;
            updateData.create_next_activity = true;
            if (resetStepToZero || isManual) {
                updateData.last_automated_step = 0;
            }
        } else {
            updateData.last_automated_step = 0;
            updateData.is_last_automated_step_delivered = false;
            updateData.create_next_activity = true;
        }
    } else if (resetStepToZero) {
        updateData.last_automated_step = 0;
    }

    await tx.customerCollectionPeriod.update({
        where: { id: collectionPeriodId },
        data: updateData,
    });

    const leavingAutomatedOrPtp =
        previousCategory === "Automated" ||
        previousCategory === "Promise_to_pay";
    if (leavingAutomatedOrPtp) {
        const cancelData: Record<string, unknown> = {
            status: "CANCELLED",
            modified_at: new Date(),
        };
        if (isPersistedUserId(userId)) {
            cancelData.modified_by = userId;
        }
        await tx.activity.updateMany({
            where: {
                collection_period_id: collectionPeriodId,
                status: { in: ["SCHEDULED", "PAUSED"] },
            },
            data: cancelData,
        });
    }

    if (previousCategory === "Promise_to_pay") {
        await tx.activity.deleteMany({
            where: {
                collection_period_id: collectionPeriodId,
                ActivitiesSequence: {
                    category: "Promise_to_pay",
                },
                status: { in: ["SCHEDULED", "PAUSED"] },
            },
        });
    }

    const actorId = userId || "system";
    const nextCategoryKey = categoryTranslationKey(nextCategory);
    const title = previousCategory
        ? "{{activities.fields.category_change}}"
        : "{{activities.fields.category_change_to}}";
    const titleParams: Record<string, string> = previousCategory
        ? {
              oldCategory: categoryTranslationKey(previousCategory),
              newCategory: nextCategoryKey,
              userId: actorId,
          }
        : {
              newCategory: nextCategoryKey,
              userId: actorId,
          };

    const now = new Date();
    const activityData: Record<string, unknown> = {
        customer_id: customerId,
        account_id: accountId,
        collection_period_id: collectionPeriodId,
        type: "Internal",
        title,
        title_params: titleParams,
        content: "",
        schedule_time: now,
        actual_delivery_time: now,
        status: "COMPLETED",
        system_generated: !isManual,
    };
    if (isPersistedUserId(userId)) {
        activityData.created_by = userId;
        activityData.modified_by = userId;
    }

    await tx.activity.create({ data: activityData });
    return true;
}

export type OpenPeriodForCategory = {
    id: number;
    current_category: string | null;
    previous_category?: string | null;
};

/**
 * After a dispute is Resolved/Cancelled: if no other open disputes remain and
 * the open period is still in Dispute, move category to Agent.
 */
export async function revertCategoryAfterLastDisputeClosed(
    tx: CategoryChangeDb & {
        customerCollectionPeriod: CategoryChangeDb["customerCollectionPeriod"] & {
            findFirst: (args: {
                where: Record<string, unknown>;
                select?: Record<string, unknown>;
                orderBy?: Record<string, unknown>;
            }) => Promise<OpenPeriodForCategory | null>;
        };
    },
    params: {
        customerId: number;
        accountId: number;
        userId?: string | null;
        /** Dispute just closed — exclude from open count when already updated. */
        excludeDisputeId?: number;
    }
): Promise<boolean> {
    const openCount = await tx.customerDispute.count({
        where: {
            customer_id: params.customerId,
            dispute_status: { notIn: ["Resolved", "Cancelled"] },
            ...(params.excludeDisputeId != null
                ? { id: { not: params.excludeDisputeId } }
                : {}),
        },
    });
    if (openCount > 0) {
        return false;
    }

    const period = await tx.customerCollectionPeriod.findFirst({
        where: {
            customer_id: params.customerId,
            period_end_date: null,
        },
        select: {
            id: true,
            current_category: true,
            previous_category: true,
        },
        orderBy: { id: "desc" },
    });
    if (!period || period.current_category !== "Dispute") {
        return false;
    }

    return applyCollectionPeriodCategoryChange(tx, {
        collectionPeriodId: period.id,
        customerId: params.customerId,
        accountId: params.accountId,
        currentCategory: period.current_category,
        nextCategory: "Agent",
        userId: params.userId,
        isManual: false,
    });
}
