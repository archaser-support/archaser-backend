import type { PrismaClient } from "@prisma/client";

import { scheduleDateTime } from "../scheduling/scheduleDateTime";
import { getRawTemplateContent } from "../templates/processTemplateContent";
import { getSystemUserId } from "../users/getSystemUserId";

/**
 * Port of ActivityService.createPromiseToPayScheduledActivity.
 * Creates SCHEDULED Promise_to_pay activities from the account's active
 * Promise_to_pay sequence steps, anchored on the period's promise_to_pay_date.
 */
export async function createPromiseToPayScheduledActivities(
    prisma: PrismaClient,
    params: {
        collectionPeriodId: number;
        userId?: string | null;
    }
): Promise<{ created: number }> {
    const { collectionPeriodId, userId } = params;

    const collectionPeriod = await prisma.customerCollectionPeriod.findUnique({
        where: { id: collectionPeriodId },
        select: {
            id: true,
            promise_to_pay_date: true,
            customer_id: true,
            Customer: {
                select: {
                    id: true,
                    account_id: true,
                    language: true,
                    email: true,
                    type: true,
                    customer_uuid: true,
                    Country: { select: { iso2: true } },
                    State: { select: { iso2: true } },
                    Person: { select: { first_name: true } },
                    Company: { select: { name: true } },
                },
            },
        },
    });

    if (!collectionPeriod?.Customer?.account_id) {
        return { created: 0 };
    }
    if (!collectionPeriod.promise_to_pay_date) {
        return { created: 0 };
    }

    const customer = collectionPeriod.Customer;
    const accountId = customer.account_id;

    await cancelNonPromiseToPayScheduled(prisma, collectionPeriodId);
    // Always replace existing PTP scheduled steps when (re)logging a promise.
    await prisma.activity.updateMany({
        where: {
            collection_period_id: collectionPeriodId,
            status: "SCHEDULED",
            type: "Promise_to_pay",
        },
        data: {
            status: "CANCELLED",
            title: "{{activities.fields.activity_promise_to_pay_canceled}}",
            modified_at: new Date(),
        },
    });

    const sequences = await prisma.activitiesSequence.findMany({
        where: {
            account_id: accountId,
            category: "Promise_to_pay",
            active: true,
        },
        include: {
            ActivitiesTemplate: {
                include: { ActivityTemplateLanguage: true },
            },
        },
        orderBy: { step: "asc" },
    });

    if (sequences.length === 0) {
        return { created: 0 };
    }

    const systemUserId =
        (userId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            userId
        )
            ? userId
            : null) ?? (await getSystemUserId(prisma, accountId));
    if (!systemUserId) {
        return { created: 0 };
    }

    const contacts = await prisma.contact.findMany({
        where: {
            customer_id: customer.id,
            status: "Active",
        },
        select: {
            id: true,
            email: true,
            mobile: true,
            receives_standard_reminder: true,
            receives_escalated_reminder: true,
        },
        orderBy: [
            { receives_standard_reminder: "desc" },
            { receives_escalated_reminder: "desc" },
            { id: "asc" },
        ],
    });

    let created = 0;
    const baseDate = new Date(collectionPeriod.promise_to_pay_date);
    const countryCode = customer.Country?.iso2 ?? undefined;
    const stateCode = customer.State?.iso2 ?? undefined;

    for (const step of sequences) {
        if (!step.ActivitiesTemplate) {
            continue;
        }

        const raw = getRawTemplateContent(step, customer.language);
        const content = (raw.content || "").trim();
        if (!content) {
            continue;
        }

        const scheduleResult = await scheduleDateTime({
            baseDate,
            timeOfDay: step.time_of_day || "09:00",
            daysToAdd: step.days_from_prev_step ?? 0,
            countryCode,
            stateCode,
            skipWeekends: true,
            skipHolidays: true,
            businessHoursOnly: false,
            returnUTC: true,
            preserveInputDate: true,
        });

        const channel =
            step.activity_type === "SMS" ||
            step.activity_type === "WhatsApp" ||
            step.activity_type === "Email"
                ? step.activity_type
                : "Email";

        const activity = await prisma.activity.create({
            data: {
                customer_id: customer.id,
                account_id: accountId,
                collection_period_id: collectionPeriodId,
                type: "Promise_to_pay",
                title: "{{activities.fields.activity_promise_to_pay_scheduled}}",
                content,
                schedule_time: scheduleResult.scheduledTime,
                schedule_calculation: scheduleResult.calculation,
                status: "SCHEDULED",
                system_generated: true,
                activity_sequence_id: step.id,
                activity_template: step.ActivitiesTemplate.id,
                title_params: {
                    contacts: String(contacts.length),
                    time: scheduleResult.scheduledTime.toISOString(),
                    userId: userId || "system",
                },
                created_by: systemUserId,
                modified_by: systemUserId,
            },
        });

        if (contacts.length > 0) {
            await prisma.activityContact.createMany({
                data: contacts.map((c) => ({
                    activity_id: activity.id,
                    contact_id: c.id,
                    status: "Scheduled",
                    communication_channel: channel,
                    created_by: systemUserId,
                    modified_by: systemUserId,
                })),
            });
        }

        created += 1;
    }

    return { created };
}

async function cancelNonPromiseToPayScheduled(
    prisma: PrismaClient,
    collectionPeriodId: number
): Promise<void> {
    await prisma.activity.updateMany({
        where: {
            collection_period_id: collectionPeriodId,
            status: "SCHEDULED",
            type: { not: "Promise_to_pay" },
        },
        data: {
            status: "CANCELLED",
            modified_at: new Date(),
        },
    });
}
