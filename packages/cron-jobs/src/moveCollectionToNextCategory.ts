import type { PrismaClient } from "@prisma/client";
import type { CronJobResult } from "./handlers";

/**
 * Move collections to next category
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * server/cron-jobs/MoveCollectionToNextCategory.ts
 *
 * Algorithm:
 * Phase 1: Handle expired promises to pay
 * Phase 2: Process collections with next_category_date <= now and next_category is not null
 */
export async function moveCollectionToNextCategory(
    prisma: PrismaClient
): Promise<CronJobResult> {
    const start = Date.now();
    const summary = {
        phase1: {
            expiredPromisesFound: 0,
            promisesUpdated: 0,
        },
        phase2: {
            collectionsFound: 0,
            collectionsProcessed: 0,
            collectionsFailed: 0,
        },
        errors: [] as string[],
    };

    try {
        const now = new Date();

        // PHASE 1: Handle expired promises to pay
        const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const expiredCollections =
            await prisma.customerCollectionPeriod.findMany({
                where: {
                    current_category: "Promise_to_pay",
                    promise_to_pay_date: { lte: last24Hours },
                    // Exclude credit-only customers (has_credit_insurance=true, has_collection=false)
                    Customer: {
                        Account: {
                            OR: [
                                { has_collection: true },
                                { has_credit_insurance: { not: true } },
                            ],
                        },
                    },
                },
                select: {
                    id: true,
                    previous_category: true,
                },
            });

        summary.phase1.expiredPromisesFound = expiredCollections.length;

        // Update expired promises: set next_category to previous_category or "Automated"
        for (const collection of expiredCollections) {
            try {
                const nextCategory =
                    collection.previous_category || "Automated";

                await prisma.customerCollectionPeriod.update({
                    where: { id: collection.id },
                    data: {
                        next_category: nextCategory,
                        next_category_date: now,
                    },
                });

                summary.phase1.promisesUpdated++;
            } catch (error) {
                const errorMsg = `Failed to update expired promise collection ${collection.id}: ${error instanceof Error ? error.message : "Unknown"}`;
                summary.errors.push(errorMsg);
            }
        }

        // PHASE 2: Process collections with next_category_date <= now
        const collections = await prisma.customerCollectionPeriod.findMany({
            where: {
                next_category: { not: null },
                next_category_date: { lte: now },
                // Exclude credit-only customers
                Customer: {
                    Account: {
                        OR: [
                            { has_collection: true },
                            { has_credit_insurance: { not: true } },
                        ],
                    },
                },
            },
            include: {
                Customer: {
                    select: {
                        account_id: true,
                        id: true,
                    },
                },
            },
        });

        summary.phase2.collectionsFound = collections.length;

        // Filter collections based on wait_days_after_automated logic
        // (for Automated->Agent transitions, check if wait_days has elapsed)
        const filteredCollections = [];
        for (const collection of collections) {
            // For non-Automated transitions or null current_category, process immediately
            if (
                collection.current_category !== "Automated" ||
                collection.next_category === null
            ) {
                filteredCollections.push(collection);
                continue;
            }

            // For Automated->Agent transitions, check wait_days_after_automated
            if (
                collection.current_category === "Automated" &&
                collection.next_category === "Agent"
            ) {
                // Fetch wait_days_after_automated from account settings
                const account = await prisma.account.findUnique({
                    where: { id: collection.Customer.account_id },
                    select: { wait_days_after_automated: true },
                });

                const waitDays = account?.wait_days_after_automated || 0;

                if (waitDays > 0 && collection.next_category_date) {
                    const requiredWaitTime = waitDays * 24 * 60 * 60 * 1000;
                    const timeSinceNextCategoryDate =
                        now.getTime() - collection.next_category_date.getTime();

                    if (timeSinceNextCategoryDate < requiredWaitTime) {
                        // Wait period not elapsed yet, skip this collection
                        continue;
                    }
                }
            }

            filteredCollections.push(collection);
        }

        // Process filtered collections
        for (const collection of filteredCollections) {
            try {
                // SLIM updateCollectionPeriodCategory:
                // Core Prisma updates for category change
                // (skip activity timeline creation - too complex for cron)
                await updateCollectionPeriodCategorySlim(
                    prisma,
                    collection.id,
                    collection.next_category!,
                    collection.current_category!,
                    collection.Customer.account_id,
                    collection.Customer.id
                );

                summary.phase2.collectionsProcessed++;
            } catch (error) {
                const errorMsg = `Failed to process collection ${collection.id}: ${error instanceof Error ? error.message : "Unknown"}`;
                summary.errors.push(errorMsg);
                summary.phase2.collectionsFailed++;
            }
        }

        // Invalidate dashboard cache for affected accounts (best-effort)
        try {
            const accountIds = Array.from(
                new Set(
                    filteredCollections.map((c) => c.Customer.account_id)
                )
            );
            // TODO: Import invalidateDashboardCacheForAccounts if available
            // For now, skip cache invalidation in cron-jobs package
        } catch (cacheError) {
            // Cache errors should not break the cron job
        }

        const message = `Phase 1: ${summary.phase1.promisesUpdated}/${summary.phase1.expiredPromisesFound} expired promises updated. Phase 2: ${summary.phase2.collectionsProcessed}/${summary.phase2.collectionsFound} collections processed (${summary.phase2.collectionsFailed} failed)`;

        return {
            success: true,
            message,
            summary,
            durationMs: Date.now() - start,
        };
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Move collection to next category failed";
        return {
            success: false,
            message,
            summary,
            durationMs: Date.now() - start,
        };
    }
}

/**
 * SLIM updateCollectionPeriodCategory: Core Prisma updates for category change
 *
 * Omitted from historical implementation:
 * - ActivityService.createCategoryChangeActivity (complex activity timeline creation)
 * - LogService calls (skip all logging)
 * - Translation handling (not needed for cron)
 * - Complex validation (assume cron data is valid)
 *
 * TODO: If activity timeline creation is needed, wire it as a separate cron job
 * or integrate with Activity Workflow Manager
 */
async function updateCollectionPeriodCategorySlim(
    prisma: PrismaClient,
    collectionId: number,
    nextCategory: string,
    currentCategory: string,
    accountId: number,
    customerId: number
): Promise<void> {
    // Skip if categories are the same
    if (nextCategory === currentCategory) {
        return;
    }

    // Prepare update data
    const updateData: any = {
        next_category: null,
        next_category_date: null,
        current_category: nextCategory,
        previous_category: currentCategory,
        modified_at: new Date(),
    };

    // When changing to Automated category:
    // - From Promise_to_pay or Dispute: preserve last_automated_step (resume)
    // - From other categories: reset step to 0
    if (nextCategory === "Automated") {
        if (
            currentCategory === "Promise_to_pay" ||
            currentCategory === "Dispute"
        ) {
            // Resume from current step
            updateData.is_last_automated_step_delivered = false;
            updateData.create_next_activity = true;
        } else {
            // Reset to step 0
            updateData.last_automated_step = 0;
            updateData.is_last_automated_step_delivered = false;
            updateData.create_next_activity = true;
        }
    }

    // Cancel scheduled/paused activities when leaving Automated or Promise_to_pay
    let activitiesToCancel: any = null;
    if (
        currentCategory === "Automated" ||
        currentCategory === "Promise_to_pay"
    ) {
        activitiesToCancel = {
            collection_period_id: collectionId,
            status: { in: ["SCHEDULED", "PAUSED"] },
        };
    }

    // Delete promise-to-pay activities when leaving Promise_to_pay
    let promiseActivitiesToDelete: any = null;
    if (currentCategory === "Promise_to_pay") {
        promiseActivitiesToDelete = {
            collection_period_id: collectionId,
            ActivitiesSequence: { category: "Promise_to_pay" },
            status: { in: ["SCHEDULED", "PAUSED"] },
        };
    }

    // Execute updates in a transaction
    await prisma.$transaction(async (tx) => {
        // Update collection period
        await tx.customerCollectionPeriod.update({
            where: { id: collectionId },
            data: updateData,
        });

        // Cancel activities if needed (simple updateMany)
        if (activitiesToCancel) {
            await tx.activity.updateMany({
                where: activitiesToCancel,
                data: {
                    status: "CANCELLED",
                    modified_at: new Date(),
                },
            });
        }

        // Delete promise-to-pay activities if needed
        if (promiseActivitiesToDelete) {
            await tx.activity.deleteMany({
                where: promiseActivitiesToDelete,
            });
        }

        // TODO: Create category change activity in Activity table
        // This is deferred - too complex for cron
        // Historical code calls ActivityService.createCategoryChangeActivity
        // which builds translated title, activity content, etc.
        // For now, the category change is recorded in the collection period
        // but no activity timeline entry is created.
    });
}
