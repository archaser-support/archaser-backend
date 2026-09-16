import type { PrismaClient } from "@prisma/client";

export type ActivityContactDeliveryOutcome =
    | "delivered"
    | "failed"
    | "bounced"
    | "sent";

export type ApplyActivityContactDeliveryOptions = {
    errorMsg?: string | null;
    bounceType?: string | null;
    bounceSubType?: string | null;
    /** Extra ActivityContact fields (opens, clicks, complaint, etc.). */
    extraContactData?: Record<string, unknown>;
};

/**
 * Shared delivery handler for SMS/Email webhooks and Inforu status poll.
 * Updates ActivityContact + parent Activity, and enables collection-period
 * advancement when a message is delivered on an Automated period.
 */
export async function applyActivityContactDelivery(
    prisma: PrismaClient,
    activityContactId: number,
    outcome: ActivityContactDeliveryOutcome,
    options: ApplyActivityContactDeliveryOptions = {}
): Promise<{ updated: boolean }> {
    const row = await prisma.activityContact.findUnique({
        where: { id: activityContactId },
        include: {
            Activity: {
                select: {
                    id: true,
                    status: true,
                    is_last_step: true,
                    CustomerCollectionPeriod: {
                        select: {
                            id: true,
                            current_category: true,
                            is_last_automated_step_delivered: true,
                            Customer: {
                                select: {
                                    Account: {
                                        select: {
                                            category_after_automated: true,
                                            wait_days_after_automated: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!row) {
        return { updated: false };
    }

    let activityStatus: "DELIVERED" | "FAILED" | "SENT";
    let contactStatus: "Delivered" | "Failed" | "Bounced" | "Sent";

    if (outcome === "delivered") {
        activityStatus = "DELIVERED";
        contactStatus = "Delivered";
    } else if (outcome === "failed" || outcome === "bounced") {
        activityStatus = "FAILED";
        contactStatus = outcome === "bounced" ? "Bounced" : "Failed";
    } else {
        // Intermediate "sent" — keep parent sendable state as SENT if already past SCHEDULED.
        activityStatus = "SENT";
        contactStatus = "Sent";
    }

    const now = new Date();
    const deliveryTime = outcome === "delivered" ? now : null;
    const failureTime =
        outcome === "failed" || outcome === "bounced" ? now : null;

    await prisma.$transaction(async (tx) => {
        await tx.activityContact.update({
            where: { id: row.id },
            data: {
                status: contactStatus,
                delivered_at: deliveryTime,
                failed_at: failureTime,
                failure_reason: options.errorMsg ?? null,
                ...(outcome === "bounced"
                    ? {
                          bounced_at: now,
                          bounce_type: options.bounceType ?? null,
                          bounce_sub_type: options.bounceSubType ?? null,
                      }
                    : {}),
                ...(options.extraContactData || {}),
                modified_at: now,
            } as never,
        });

        const activity = row.Activity;
        if (!activity) {
            return;
        }

        // Do not downgrade a terminal activity status on a later contact event.
        const current = String(activity.status || "");
        const terminal = current === "DELIVERED" || current === "FAILED";
        if (!terminal || activityStatus === "DELIVERED") {
            await tx.activity.update({
                where: { id: activity.id },
                data: {
                    status: activityStatus,
                    ...(deliveryTime
                        ? { actual_delivery_time: deliveryTime }
                        : {}),
                    modified_at: now,
                } as never,
            });
        }

        const collectionPeriod = activity.CustomerCollectionPeriod;
        if (
            !collectionPeriod ||
            outcome !== "delivered" ||
            collectionPeriod.current_category !== "Automated"
        ) {
            return;
        }

        if (!activity.is_last_step) {
            await tx.customerCollectionPeriod.update({
                where: { id: collectionPeriod.id },
                data: {
                    create_next_activity: true,
                    modified_at: now,
                },
            });
            return;
        }

        if (collectionPeriod.is_last_automated_step_delivered) {
            return;
        }

        const account = collectionPeriod.Customer?.Account;
        const targetCategory = account?.category_after_automated || "Agent";
        const waitDays = account?.wait_days_after_automated || 0;
        const nextCategoryDate = new Date(
            now.getTime() + waitDays * 24 * 60 * 60 * 1000
        );

        await tx.customerCollectionPeriod.update({
            where: { id: collectionPeriod.id },
            data: {
                next_category: targetCategory,
                next_category_date: nextCategoryDate,
                is_last_automated_step_delivered: true,
                create_next_activity: false,
                modified_at: now,
            },
        });
    });

    return { updated: true };
}
