import type { PrismaClient } from "@prisma/client";
import type { CronJobResult } from "./handlers";
import { createCategoryChangeActivity } from "./activities/createCategoryChangeActivity";
import { invalidateDashboardCacheForAccounts } from "./dashboard/invalidateDashboardCacheForAccounts";
import { publishControlCenterUpdate } from "./realtime/publishControlCenterUpdate";

/**
 * Move collections to next category
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * server/cron-jobs/MoveCollectionToNextCategory.ts
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

        const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const expiredCollections =
            await prisma.customerCollectionPeriod.findMany({
                where: {
                    current_category: "Promise_to_pay",
                    promise_to_pay_date: { lte: last24Hours },
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

        const collections = await prisma.customerCollectionPeriod.findMany({
            where: {
                next_category: { not: null },
                next_category_date: { lte: now },
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

        const filteredCollections = [];
        for (const collection of collections) {
            if (
                collection.current_category !== "Automated" ||
                collection.next_category === null
            ) {
                filteredCollections.push(collection);
                continue;
            }

            if (
                collection.current_category === "Automated" &&
                collection.next_category === "Agent"
            ) {
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
                        continue;
                    }
                }
            }

            filteredCollections.push(collection);
        }

        for (const collection of filteredCollections) {
            try {
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

        try {
            const accountIds = Array.from(
                new Set(
                    filteredCollections.map((c) => c.Customer.account_id)
                )
            );
            if (accountIds.length > 0) {
                await invalidateDashboardCacheForAccounts(prisma, accountIds);
            }
        } catch {
            // Cache errors should not break the cron job
        }

        if (summary.phase2.collectionsProcessed > 0) {
            await publishControlCenterUpdate(
                `moveCollectionToNextCategory: processed ${summary.phase2.collectionsProcessed} collection(s)`,
                {
                    excludeFromNotifications: true,
                    source: "automated",
                }
            );
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

async function updateCollectionPeriodCategorySlim(
    prisma: PrismaClient,
    collectionId: number,
    nextCategory: string,
    currentCategory: string,
    accountId: number,
    customerId: number
): Promise<void> {
    if (nextCategory === currentCategory) {
        return;
    }

    const updateData: Record<string, unknown> = {
        next_category: null,
        next_category_date: null,
        current_category: nextCategory,
        previous_category: currentCategory,
        modified_at: new Date(),
    };

    if (nextCategory === "Automated") {
        if (
            currentCategory === "Promise_to_pay" ||
            currentCategory === "Dispute"
        ) {
            updateData.is_last_automated_step_delivered = false;
            updateData.create_next_activity = true;
        } else {
            updateData.last_automated_step = 0;
            updateData.is_last_automated_step_delivered = false;
            updateData.create_next_activity = true;
        }
    }

    let activitiesToCancel: Record<string, unknown> | null = null;
    if (
        currentCategory === "Automated" ||
        currentCategory === "Promise_to_pay"
    ) {
        activitiesToCancel = {
            collection_period_id: collectionId,
            status: { in: ["SCHEDULED", "PAUSED"] },
        };
    }

    let promiseActivitiesToDelete: Record<string, unknown> | null = null;
    if (currentCategory === "Promise_to_pay") {
        promiseActivitiesToDelete = {
            collection_period_id: collectionId,
            ActivitiesSequence: { category: "Promise_to_pay" },
            status: { in: ["SCHEDULED", "PAUSED"] },
        };
    }

    await prisma.$transaction(async (tx) => {
        await tx.customerCollectionPeriod.update({
            where: { id: collectionId },
            data: updateData,
        });

        if (activitiesToCancel) {
            await tx.activity.updateMany({
                where: activitiesToCancel,
                data: {
                    status: "CANCELLED",
                    modified_at: new Date(),
                },
            });
        }

        if (promiseActivitiesToDelete) {
            await tx.activity.deleteMany({
                where: promiseActivitiesToDelete,
            });
        }

        await createCategoryChangeActivity(tx as unknown as PrismaClient, {
            customerId,
            collectionId,
            accountId,
            currentCategory,
            nextCategory,
        });
    });
}
