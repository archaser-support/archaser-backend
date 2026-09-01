"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processAutomatedCollectionPeriods = processAutomatedCollectionPeriods;
/**
 * Process Automated Collection Periods
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * server/cron-jobs/processAutomatedCollectionPeriods.ts
 *
 * BEST-EFFORT PORT: Prisma-only phases
 *
 * Algorithm:
 * Phase 0: Sequence Reset - Enable activity creation for manually changed Automated periods
 * Phase 1: Mark Last Steps - Mark activities/periods at last automated step
 * Phase 2: Prepare Next Activities - Enable next activity creation flag
 * Phase 3: Transition Setup - Set next_category for completed Automated periods
 *
 * SKIPPED (require Activity Workflow Manager):
 * - Activity creation (createAutomatedActivity)
 * - Email/SMS sending
 * - Complex activity timeline logic
 * - CustomerService.calculateNextAutomatedActivityTime (complex date calc)
 */
async function processAutomatedCollectionPeriods(prisma, freeze) {
    const start = Date.now();
    const summary = {
        phase0: {
            periodsFound: 0,
            periodsReset: 0,
        },
        phase1: {
            activitiesFound: 0,
            activitiesMarked: 0,
            periodsMarked: 0,
        },
        phase2: {
            periodsFound: 0,
            periodsEnabled: 0,
        },
        phase3: {
            periodsFound: 0,
            periodsSetup: 0,
        },
        skippedForActivityPlatform: {
            activityCreation: "Phase 2 date calculation skipped",
            emailSms: "All communication skipped",
        },
        errors: [],
    };
    try {
        const now = new Date();
        // Exclude credit-only customers helper
        const excludeCreditOnlyWhere = (extra) => ({
            ...(freeze ? freeze.accountIdNotInFilter() : {}),
            Account: {
                OR: [
                    { has_collection: true },
                    { has_credit_insurance: { not: true } },
                ],
            },
            ...extra,
        });
        // ===== PHASE 0: Sequence Reset =====
        // Enable activity creation for periods manually changed from Agent to Automated
        const manuallyChangedPeriods = await prisma.customerCollectionPeriod.findMany({
            where: {
                current_category: "Automated",
                previous_category: "Agent",
                last_automated_step: 0,
                period_end_date: null,
                Customer: excludeCreditOnlyWhere(),
            },
            select: {
                id: true,
                customer_id: true,
                Customer: {
                    select: {
                        account_id: true,
                        sequence_container_id: true,
                    },
                },
            },
        });
        summary.phase0.periodsFound = manuallyChangedPeriods.length;
        // Get max automated steps for validation
        const accountIds = Array.from(new Set(manuallyChangedPeriods
            .map((p) => p.Customer?.account_id)
            .filter((id) => typeof id === "number")));
        const maxStepsData = accountIds.length > 0
            ? await prisma.activitiesSequence.groupBy({
                by: ["account_id", "sequence_container_id"],
                where: {
                    account_id: { in: accountIds },
                    category: "Automated",
                    active: true,
                    OR: [{ step_type: null }, { step_type: "overdue" }],
                },
                _max: {
                    step: true,
                },
            })
            : [];
        const maxStepMap = new Map();
        maxStepsData.forEach((record) => {
            if (record._max.step) {
                const key = `${record.account_id}_${record.sequence_container_id || "null"}`;
                maxStepMap.set(key, record._max.step);
            }
        });
        // Enable activity creation for periods with valid sequences
        for (const period of manuallyChangedPeriods) {
            const customer = period.Customer;
            const maxStepKey = `${customer?.account_id}_${customer?.sequence_container_id || "null"}`;
            const maxStep = maxStepMap.get(maxStepKey);
            if (!maxStep) {
                // No sequences - skip (will be handled by other cron or UI)
                continue;
            }
            await prisma.customerCollectionPeriod.update({
                where: { id: period.id },
                data: {
                    create_next_activity: true,
                    is_last_automated_step_delivered: false,
                    modified_at: now,
                },
            });
            summary.phase0.periodsReset++;
        }
        // ===== PHASE 1: Mark Last Steps =====
        // Find activities that are delivered and at the last automated step
        const activities = await prisma.activity.findMany({
            where: {
                status: "DELIVERED",
                is_last_step: false,
                CustomerCollectionPeriod: {
                    current_category: "Automated",
                    is_last_automated_step_delivered: false,
                    period_end_date: null,
                    Customer: excludeCreditOnlyWhere(),
                },
                ActivitiesSequence: {
                    category: "Automated",
                },
            },
            select: {
                id: true,
                customer_id: true,
                collection_period_id: true,
                activity_sequence_id: true,
                actual_delivery_time: true,
                CustomerCollectionPeriod: {
                    select: {
                        id: true,
                        customer_id: true,
                        last_automated_step: true,
                        previous_category: true,
                        Customer: {
                            select: {
                                account_id: true,
                                sequence_container_id: true,
                            },
                        },
                    },
                },
                ActivitiesSequence: {
                    select: {
                        id: true,
                        step: true,
                        account_id: true,
                        sequence_container_id: true,
                    },
                },
            },
        });
        summary.phase1.activitiesFound = activities.length;
        // Get max steps for all accounts
        const activityAccountIds = Array.from(new Set(activities
            .map((a) => a.CustomerCollectionPeriod?.Customer?.account_id)
            .filter((id) => typeof id === "number")));
        const activityMaxSteps = activityAccountIds.length > 0
            ? await prisma.activitiesSequence.groupBy({
                by: ["account_id", "sequence_container_id"],
                where: {
                    account_id: { in: activityAccountIds },
                    category: "Automated",
                    active: true,
                    OR: [{ step_type: null }, { step_type: "overdue" }],
                },
                _max: {
                    step: true,
                },
            })
            : [];
        const activityMaxStepMap = new Map();
        activityMaxSteps.forEach((record) => {
            if (record._max.step) {
                const key = `${record.account_id}_${record.sequence_container_id || "null"}`;
                activityMaxStepMap.set(key, record._max.step);
            }
        });
        // Filter activities to only those at the last step
        const validActivities = activities.filter((activity) => {
            const collectionPeriod = activity.CustomerCollectionPeriod;
            if (!collectionPeriod)
                return false;
            const activitySequence = activity.ActivitiesSequence;
            if (!activitySequence)
                return false;
            const actAccountId = collectionPeriod.Customer?.account_id || 0;
            const customerContainerId = collectionPeriod.Customer?.sequence_container_id ??
                activitySequence.sequence_container_id;
            const maxStepKey = `${actAccountId}_${customerContainerId ?? "null"}`;
            const maxStep = activityMaxStepMap.get(maxStepKey) || 0;
            const actStep = activitySequence.step;
            if (actStep === null)
                return false;
            const currentStep = collectionPeriod.last_automated_step || 0;
            // Skip activities from previous cycles
            if (actStep > currentStep + 1 && currentStep < maxStep - 1) {
                return false;
            }
            // Only include activities at the last step
            return actStep === maxStep;
        });
        // Mark activities as last step
        if (validActivities.length > 0) {
            const activityIds = validActivities.map((a) => a.id);
            const updateResult = await prisma.activity.updateMany({
                where: { id: { in: activityIds } },
                data: {
                    is_last_step: true,
                    modified_at: now,
                },
            });
            summary.phase1.activitiesMarked = updateResult.count;
            // Mark collection periods and set next_category
            const periodIds = Array.from(new Set(validActivities
                .map((a) => a.collection_period_id)
                .filter((id) => id !== null)));
            // Get account wait_days settings for next_category_date calculation
            const periodsToUpdate = await prisma.customerCollectionPeriod.findMany({
                where: { id: { in: periodIds } },
                select: {
                    id: true,
                    customer_id: true,
                    Customer: {
                        select: {
                            account_id: true,
                            Account: {
                                select: {
                                    category_after_automated: true,
                                    wait_days_after_automated: true,
                                },
                            },
                        },
                    },
                },
            });
            for (const period of periodsToUpdate) {
                const account = period.Customer?.Account;
                const targetCategory = account?.category_after_automated || "Agent";
                const waitDays = account?.wait_days_after_automated || 0;
                const nextCategoryDate = new Date(now.getTime() + waitDays * 24 * 60 * 60 * 1000);
                await prisma.customerCollectionPeriod.update({
                    where: { id: period.id },
                    data: {
                        is_last_automated_step_delivered: true,
                        next_category: targetCategory,
                        next_category_date: nextCategoryDate,
                        modified_at: now,
                    },
                });
                summary.phase1.periodsMarked++;
            }
        }
        // ===== PHASE 2: Prepare Next Activities =====
        // Find periods ready for next activity creation
        const periodsForNextActivity = await prisma.customerCollectionPeriod.findMany({
            where: {
                current_category: "Automated",
                create_next_activity: false,
                is_last_automated_step_delivered: false,
                period_end_date: null,
                Customer: excludeCreditOnlyWhere({
                    automation_stuck_no_contacts: { not: true },
                }),
            },
            select: {
                id: true,
                customer_id: true,
                last_automated_step: true,
                period_start_date: true,
                Customer: {
                    select: {
                        account_id: true,
                    },
                },
            },
        });
        summary.phase2.periodsFound = periodsForNextActivity.length;
        if (periodsForNextActivity.length > 0) {
            // Check for pending activities
            const periodIds = periodsForNextActivity.map((p) => p.id);
            const pendingActivities = await prisma.activity.findMany({
                where: {
                    collection_period_id: { in: periodIds },
                    status: "SCHEDULED",
                    ActivitiesSequence: {
                        category: "Automated",
                    },
                },
                select: {
                    collection_period_id: true,
                },
            });
            const pendingPeriodIds = new Set(pendingActivities
                .map((a) => a.collection_period_id)
                .filter((id) => id !== null));
            // Get all activities for these periods to find latest
            const allActivities = await prisma.activity.findMany({
                where: {
                    collection_period_id: { in: periodIds },
                    ActivitiesSequence: {
                        category: "Automated",
                    },
                },
                select: {
                    collection_period_id: true,
                    status: true,
                    created_at: true,
                },
                orderBy: {
                    created_at: "desc",
                },
            });
            // Group by collection_period_id
            const latestActivitiesMap = new Map();
            for (const activity of allActivities) {
                if (activity.collection_period_id &&
                    !latestActivitiesMap.has(activity.collection_period_id)) {
                    latestActivitiesMap.set(activity.collection_period_id, {
                        collection_period_id: activity.collection_period_id,
                        status: activity.status,
                    });
                }
            }
            // Filter eligible periods
            const eligiblePeriods = periodsForNextActivity.filter((p) => {
                // Skip periods with pending activities
                if (pendingPeriodIds.has(p.id)) {
                    return false;
                }
                const latestActivity = latestActivitiesMap.get(p.id);
                // Has delivered/cancelled activities OR no activities at all
                if (latestActivity &&
                    (latestActivity.status === "DELIVERED" ||
                        latestActivity.status === "CANCELLED")) {
                    return true;
                }
                if (!latestActivity) {
                    return true;
                }
                return false;
            });
            // Enable create_next_activity flag
            // SKIP: calculating next_activity_date (needs CustomerService.calculateNextAutomatedActivityTime)
            if (eligiblePeriods.length > 0) {
                const eligibleIds = eligiblePeriods.map((p) => p.id);
                const updateResult = await prisma.customerCollectionPeriod.updateMany({
                    where: { id: { in: eligibleIds } },
                    data: {
                        create_next_activity: true,
                        modified_at: now,
                    },
                });
                summary.phase2.periodsEnabled = updateResult.count;
            }
        }
        // ===== PHASE 3: Transition Setup =====
        // Find periods that completed automated steps but have no next_category set (edge cases)
        const transitionPeriods = await prisma.customerCollectionPeriod.findMany({
            where: {
                current_category: "Automated",
                is_last_automated_step_delivered: true,
                next_category: null,
                period_end_date: null,
                Customer: excludeCreditOnlyWhere({
                    automation_stuck_no_contacts: { not: true },
                }),
            },
            select: {
                id: true,
                customer_id: true,
                last_automated_step: true,
                Customer: {
                    select: {
                        account_id: true,
                        sequence_container_id: true,
                        Account: {
                            select: {
                                category_after_automated: true,
                                wait_days_after_automated: true,
                            },
                        },
                    },
                },
            },
        });
        summary.phase3.periodsFound = transitionPeriods.length;
        if (transitionPeriods.length > 0) {
            // Get max steps for validation
            const transitionAccountIds = Array.from(new Set(transitionPeriods
                .map((p) => p.Customer?.account_id)
                .filter((id) => typeof id === "number")));
            const transitionMaxSteps = transitionAccountIds.length > 0
                ? await prisma.activitiesSequence.groupBy({
                    by: ["account_id", "sequence_container_id"],
                    where: {
                        account_id: { in: transitionAccountIds },
                        category: "Automated",
                        active: true,
                        OR: [
                            { step_type: null },
                            { step_type: "overdue" },
                        ],
                    },
                    _max: {
                        step: true,
                    },
                })
                : [];
            const transitionMaxStepMap = new Map();
            transitionMaxSteps.forEach((record) => {
                if (record._max.step) {
                    const key = `${record.account_id}_${record.sequence_container_id || "null"}`;
                    transitionMaxStepMap.set(key, record._max.step);
                }
            });
            // Get latest activities for these periods
            const transitionPeriodIds = transitionPeriods.map((p) => p.id);
            const transitionActivities = await prisma.activity.findMany({
                where: {
                    collection_period_id: { in: transitionPeriodIds },
                    ActivitiesSequence: {
                        category: "Automated",
                    },
                },
                select: {
                    collection_period_id: true,
                    status: true,
                    actual_delivery_time: true,
                    created_at: true,
                    ActivitiesSequence: {
                        select: {
                            step: true,
                        },
                    },
                },
                orderBy: {
                    created_at: "desc",
                },
            });
            // Group by collection_period_id
            const latestTransitionActivities = new Map();
            for (const activity of transitionActivities) {
                if (activity.collection_period_id &&
                    !latestTransitionActivities.has(activity.collection_period_id)) {
                    latestTransitionActivities.set(activity.collection_period_id, activity);
                }
            }
            // Set next_category for eligible periods
            for (const period of transitionPeriods) {
                const activity = latestTransitionActivities.get(period.id);
                if (!activity || activity.status !== "DELIVERED") {
                    continue;
                }
                const customer = period.Customer;
                const actStep = activity.ActivitiesSequence?.step || 0;
                const maxStepKey = `${customer?.account_id}_${customer?.sequence_container_id || "null"}`;
                const maxStep = transitionMaxStepMap.get(maxStepKey) || 0;
                // Only transition if at last step
                if (actStep !== maxStep) {
                    continue;
                }
                const account = customer?.Account;
                const targetCategory = account?.category_after_automated || "Agent";
                const waitDays = account?.wait_days_after_automated || 0;
                // Use actual_delivery_time or created_at
                const deliveryTime = activity.actual_delivery_time || activity.created_at;
                const nextCategoryDate = new Date(deliveryTime.getTime() + waitDays * 24 * 60 * 60 * 1000);
                await prisma.customerCollectionPeriod.update({
                    where: { id: period.id },
                    data: {
                        next_category: targetCategory,
                        next_category_date: nextCategoryDate,
                        modified_at: now,
                    },
                });
                summary.phase3.periodsSetup++;
            }
        }
        if (freeze && freeze.frozenAccountIds.size > 0) {
            const skippedRows = await prisma.customerCollectionPeriod.findMany({
                where: {
                    period_end_date: null,
                    current_category: "Automated",
                    Customer: {
                        account_id: { in: [...freeze.frozenAccountIds] },
                        Account: {
                            OR: [
                                { has_collection: true },
                                { has_credit_insurance: { not: true } },
                            ],
                        },
                    },
                },
                select: {
                    Customer: { select: { account_id: true } },
                },
                distinct: ["customer_id"],
            });
            freeze.reportSkips(skippedRows
                .map((row) => row.Customer?.account_id)
                .filter((id) => id != null));
        }
        const message = `Phase 0: ${summary.phase0.periodsReset}/${summary.phase0.periodsFound} periods reset. Phase 1: ${summary.phase1.activitiesMarked} activities, ${summary.phase1.periodsMarked} periods marked. Phase 2: ${summary.phase2.periodsEnabled}/${summary.phase2.periodsFound} periods enabled. Phase 3: ${summary.phase3.periodsSetup}/${summary.phase3.periodsFound} periods setup. Activity creation/email/SMS skipped (requires Activity Workflow Manager).`;
        return {
            success: true,
            message,
            summary,
            durationMs: Date.now() - start,
        };
    }
    catch (error) {
        const message = error instanceof Error
            ? error.message
            : "Process automated collection periods failed";
        summary.errors.push(message);
        return {
            success: false,
            message,
            summary,
            durationMs: Date.now() - start,
        };
    }
}
