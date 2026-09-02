"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkInforuSmsStatus = checkInforuSmsStatus;
const jobLog_1 = require("./logging/jobLog");
/**
 * Check SMS delivery status for pending Inforu messages
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * server/services/InforuStatusChecker.ts
 */
async function checkInforuSmsStatus(prisma, freeze) {
    const start = Date.now();
    const summary = {
        pendingMessagesFound: 0,
        messagesProcessed: 0,
        statusUpdates: 0,
        errors: 0,
    };
    try {
        // Find all pending Inforu SMS messages (last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const pendingMessages = await prisma.activityContact.findMany({
            where: {
                status: { in: ["Sent", "Scheduled"] },
                communication_channel: "SMS",
                SMSVendor: { provider: "inforu" },
                OR: [
                    { vendor_message_id: { not: null } },
                    { message_id: { not: null } },
                ],
                created_at: { gte: sevenDaysAgo },
                ...(freeze && freeze.frozenAccountIds.size > 0
                    ? {
                        Activity: {
                            account_id: {
                                notIn: [...freeze.frozenAccountIds],
                            },
                        },
                    }
                    : {}),
            },
            include: {
                SMSVendor: true,
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
                            },
                        },
                    },
                },
            },
            take: 20, // Process 20 messages per run
        });
        summary.pendingMessagesFound = pendingMessages.length;
        const reportFrozenSkips = async () => {
            if (!freeze || freeze.frozenAccountIds.size === 0) {
                return;
            }
            const skippedRows = await prisma.activityContact.findMany({
                where: {
                    status: { in: ["Sent", "Scheduled"] },
                    communication_channel: "SMS",
                    SMSVendor: { provider: "inforu" },
                    OR: [
                        { vendor_message_id: { not: null } },
                        { message_id: { not: null } },
                    ],
                    created_at: { gte: sevenDaysAgo },
                    Activity: {
                        account_id: { in: [...freeze.frozenAccountIds] },
                    },
                },
                select: {
                    Activity: { select: { account_id: true } },
                },
            });
            freeze.reportSkips(skippedRows
                .map((row) => row.Activity?.account_id)
                .filter((id) => id != null));
        };
        if (pendingMessages.length === 0) {
            await reportFrozenSkips();
            return {
                success: true,
                message: "No pending Inforu SMS messages to check",
                summary,
                durationMs: Date.now() - start,
            };
        }
        // Process messages in batches of 5
        const batchSize = 5;
        for (let i = 0; i < pendingMessages.length; i += batchSize) {
            const batch = pendingMessages.slice(i, i + batchSize);
            await Promise.all(batch.map(async (message) => {
                try {
                    const updated = await checkMessageStatus(prisma, message);
                    summary.messagesProcessed++;
                    if (updated)
                        summary.statusUpdates++;
                }
                catch (error) {
                    summary.errors++;
                    (0, jobLog_1.jobLog)("InforuSmsStatusCheck", "error", `Failed to process message ${message.id}`, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }));
            // Delay between batches to avoid API rate limits
            if (i + batchSize < pendingMessages.length) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        }
        await reportFrozenSkips();
        return {
            success: true,
            message: `Processed ${summary.messagesProcessed} messages, ${summary.statusUpdates} status updates, ${summary.errors} errors`,
            summary,
            durationMs: Date.now() - start,
        };
    }
    catch (error) {
        const message = error instanceof Error
            ? error.message
            : "Inforu SMS status check failed";
        return {
            success: false,
            message,
            summary,
            durationMs: Date.now() - start,
        };
    }
}
/**
 * Check status for a specific message and update if changed
 */
async function checkMessageStatus(prisma, message) {
    if (!message.SMSVendor) {
        return false;
    }
    const vendor = message.SMSVendor;
    const messageIdToCheck = message.vendor_message_id || message.message_id;
    if (!messageIdToCheck) {
        (0, jobLog_1.jobLog)("InforuSmsStatusCheck", "warn", `[InforuSmsStatusCheck] No message ID for ActivityContact ${message.id}`);
        return false;
    }
    // Get message status from Inforu API
    const status = await getInforuMessageStatus(vendor, messageIdToCheck);
    if (!status) {
        return false; // No update needed (status unchanged or API error)
    }
    // Update ActivityContact and Activity status
    if (message.message_id) {
        await handleSMSDeliverySlim(prisma, message, status.status, status.error);
        return true;
    }
    (0, jobLog_1.jobLog)("InforuSmsStatusCheck", "warn", `[InforuSmsStatusCheck] Cannot update - no message_id for ActivityContact ${message.id}`);
    return false;
}
/**
 * Get message status from Inforu API
 * CRITICAL (D56): Uses ONLY DB credentials from SMSVendor (api_key + api_secret OR auth_token)
 */
async function getInforuMessageStatus(vendor, messageId) {
    try {
        // CRITICAL: Use credentials from database ONLY (never hardcoded secrets)
        // Priority: auth_token > api_key+api_secret
        let authHeader;
        if (vendor.auth_token) {
            // Use auth_token directly as Bearer token
            authHeader = `Bearer ${vendor.auth_token}`;
        }
        else if (vendor.api_key && vendor.api_secret) {
            // Use api_key:api_secret as Basic auth
            const credentials = `${vendor.api_key}:${vendor.api_secret}`;
            const encoded = Buffer.from(credentials, "utf8").toString("base64");
            authHeader = `Basic ${encoded}`;
        }
        else {
            (0, jobLog_1.jobLog)("InforuSmsStatusCheck", "error", `[InforuSmsStatusCheck] Missing credentials for vendor ${vendor.id}`);
            return null;
        }
        const response = await fetch(`https://capi.inforu.co.il/api/v2/SMS/GetMessageStatus?messageId=${messageId}`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
            },
        });
        if (!response.ok) {
            throw new Error(`Inforu API error: ${response.status} ${response.statusText}`);
        }
        const responseData = await response.json();
        // Map Inforu StatusId to our status
        // 1 = Delivered, 2 = Sent/Pending, 0 = Failed/Rejected
        let status = "unknown";
        let error;
        if (responseData.StatusId === 1) {
            status = "delivered";
        }
        else if (responseData.StatusId === 2) {
            status = "sent";
        }
        else if (responseData.StatusId === 0) {
            status = "failed";
            error = responseData.StatusDescription || "Unknown error";
        }
        else {
            (0, jobLog_1.jobLog)("InforuSmsStatusCheck", "warn", `[InforuSmsStatusCheck] Unknown StatusId ${responseData.StatusId} for message ${messageId}`);
            return null; // Skip unknown statuses
        }
        // Skip if status is still "sent" (no change)
        if (status === "sent") {
            return null;
        }
        return { status, error };
    }
    catch (error) {
        (0, jobLog_1.jobLog)("InforuSmsStatusCheck", "error", `API error for message ${messageId}`, {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}
/**
 * SLIM handleSMSDelivery: Updates ActivityContact + parent Activity status
 * Includes collection-period side effects IF they are self-contained Prisma updates
 *
 * Omitted from historical implementation:
 * - LogService calls (skip all logging)
 */
async function handleSMSDeliverySlim(prisma, activityContact, statusStr, errorMsg) {
    try {
        // Map status strings
        let activityStatus;
        let contactDeliveryStatus;
        if (statusStr === "delivered") {
            activityStatus = "DELIVERED";
            contactDeliveryStatus = "Delivered";
        }
        else if (statusStr === "failed") {
            activityStatus = "FAILED";
            contactDeliveryStatus = "Failed";
        }
        else {
            activityStatus = "SCHEDULED";
            contactDeliveryStatus = "Sent";
        }
        const deliveryTime = activityStatus === "DELIVERED" ? new Date() : null;
        const failureTime = activityStatus === "FAILED" ? new Date() : null;
        // Update ActivityContact and Activity in a transaction
        await prisma.$transaction(async (tx) => {
            // Update ActivityContact
            await tx.activityContact.update({
                where: { id: activityContact.id },
                data: {
                    status: contactDeliveryStatus,
                    delivered_at: deliveryTime,
                    failed_at: failureTime,
                    failure_reason: errorMsg || null,
                    modified_at: new Date(),
                },
            });
            // Update parent Activity status
            const activity = activityContact.Activity;
            if (activity) {
                await tx.activity.update({
                    where: { id: activity.id },
                    data: {
                        status: activityStatus,
                        actual_delivery_time: deliveryTime,
                        modified_at: new Date(),
                    },
                });
                // Collection-period side effects for delivered messages
                // (only if self-contained Prisma updates)
                const collectionPeriod = activity.CustomerCollectionPeriod;
                if (collectionPeriod &&
                    contactDeliveryStatus === "Delivered" &&
                    collectionPeriod.current_category === "Automated") {
                    if (!activity.is_last_step) {
                        await tx.customerCollectionPeriod.update({
                            where: { id: collectionPeriod.id },
                            data: {
                                create_next_activity: true,
                                modified_at: new Date(),
                            },
                        });
                    }
                    // If this is the last automated step, set next_category=Agent
                    if (activity.is_last_step &&
                        !collectionPeriod.is_last_automated_step_delivered) {
                        const nextCategoryDate = new Date();
                        // Add 24 hours delay before moving to Agent (historical behavior)
                        nextCategoryDate.setHours(nextCategoryDate.getHours() + 24);
                        await tx.customerCollectionPeriod.update({
                            where: { id: collectionPeriod.id },
                            data: {
                                next_category: "Agent",
                                next_category_date: nextCategoryDate,
                                is_last_automated_step_delivered: true,
                            },
                        });
                    }
                }
            }
        });
    }
    catch (error) {
        (0, jobLog_1.jobLog)("InforuSmsStatusCheck", "error", `handleSMSDeliverySlim error for ActivityContact ${activityContact.id}`, {
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
