import type { PrismaClient } from "@prisma/client";
import { scheduleDateTime } from "./scheduleDateTime";

export type CustomerScheduleInput = {
    account_id: number;
    last_automated_step: number;
    period_start_date: Date;
    previous_category?: string | null;
};

/**
 * Port of CustomerService.calculateNextAutomatedActivityTime (Prisma-only, no LogService).
 */
export async function calculateNextAutomatedActivityTime(
    prisma: PrismaClient,
    customerDetailsMap: Map<number, CustomerScheduleInput>
): Promise<Map<number, { schedule_time: Date; schedule_calculation: string }>> {
    const customerMap = new Map<
        number,
        { schedule_time: Date; schedule_calculation: string }
    >();

    if (customerDetailsMap.size === 0) {
        return customerMap;
    }

    const accountIds = Array.from(
        new Set(
            Array.from(customerDetailsMap.values()).map((d) => d.account_id)
        )
    );
    const nextSteps = Array.from(
        new Set(
            Array.from(customerDetailsMap.values()).map(
                (d) => d.last_automated_step + 1
            )
        )
    );

    const customerIds = Array.from(customerDetailsMap.keys());
    const customers = await prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
            id: true,
            account_id: true,
            first_activity_delay_days: true,
            sequence_container_id: true,
            Country: { select: { iso2: true } },
            State: { select: { iso2: true } },
        },
    });

    const defaultSequenceContainers = await prisma.sequenceContainer.findMany({
        where: {
            account_id: { in: accountIds },
            category: "Automated",
            is_default: true,
            active: true,
        },
        select: { id: true, account_id: true },
    });

    const defaultContainersByAccount = new Map<number, number>();
    defaultSequenceContainers.forEach((container) => {
        defaultContainersByAccount.set(container.account_id, container.id);
    });

    const activitySequences = await prisma.activitiesSequence.findMany({
        where: {
            category: "Automated",
            active: true,
            account_id: { in: accountIds },
            step: { in: nextSteps },
            OR: [{ step_type: null }, { step_type: "overdue" }],
        },
        select: {
            id: true,
            account_id: true,
            time_of_day: true,
            days_from_prev_step: true,
            step: true,
            sequence_container_id: true,
        },
    });

    const validNextSteps = new Set(activitySequences.map((seq) => seq.step));
    const validCustomerDetailsMap = new Map<number, CustomerScheduleInput>();
    for (const [customerId, details] of customerDetailsMap.entries()) {
        const nextStep = details.last_automated_step + 1;
        if (validNextSteps.has(nextStep)) {
            validCustomerDetailsMap.set(customerId, details);
        }
    }

    const sequenceMap = new Map<string, (typeof activitySequences)[number]>();
    for (const seq of activitySequences) {
        const key = `${seq.account_id}-${seq.step}-${seq.sequence_container_id || "default"}`;
        sequenceMap.set(key, seq);
    }

    const customerSequenceMap = new Map<
        number,
        {
            time_of_day: string;
            days_from_prev_step: number;
        }
    >();

    for (const customer of customers) {
        const details = validCustomerDetailsMap.get(customer.id);
        if (!details) continue;

        const nextStep = details.last_automated_step + 1;
        const sequenceContainerId =
            customer.sequence_container_id ||
            defaultContainersByAccount.get(customer.account_id) ||
            null;

        let sequence: (typeof activitySequences)[number] | undefined;
        if (sequenceContainerId) {
            sequence = sequenceMap.get(
                `${customer.account_id}-${nextStep}-${sequenceContainerId}`
            );
        }
        if (!sequence) {
            sequence = sequenceMap.get(
                `${customer.account_id}-${nextStep}-default`
            );
        }

        if (sequence) {
            customerSequenceMap.set(customer.id, {
                time_of_day: sequence.time_of_day ?? "09:00",
                days_from_prev_step: sequence.days_from_prev_step ?? 0,
            });
        }
    }

    const previousActivityTimeMap = new Map<number, Date>();
    for (const [customerId, details] of validCustomerDetailsMap.entries()) {
        previousActivityTimeMap.set(customerId, new Date());
        if (details.last_automated_step > 0) {
            const customer = customers.find((c) => c.id === customerId);
            if (!customer) continue;

            const previousActivity = await prisma.activity.findFirst({
                where: {
                    customer_id: customerId,
                    status: { in: ["DELIVERED", "SENT"] },
                    ActivitiesSequence: { category: "Automated" },
                },
                orderBy: [{ created_at: "desc" }],
                select: {
                    actual_delivery_time: true,
                    last_sent_time: true,
                    created_at: true,
                },
            });

            const activityTime =
                previousActivity?.actual_delivery_time ??
                previousActivity?.last_sent_time ??
                previousActivity?.created_at;

            if (activityTime && details.last_automated_step > 0) {
                previousActivityTimeMap.set(customerId, activityTime);
            }
        }
    }

    for (const [customerId, details] of validCustomerDetailsMap.entries()) {
        try {
            const customer = customers.find((d) => d.id === customerId);
            const nextSequence = customerSequenceMap.get(customerId);
            if (!customer || !nextSequence) continue;

            const previousActivityDate =
                previousActivityTimeMap.get(customerId) ??
                details.period_start_date ??
                new Date();

            const daysToAdd =
                details.last_automated_step === 0
                    ? details.previous_category === "Agent" ||
                      details.previous_category === "Legal"
                        ? 0
                        : (customer.first_activity_delay_days ?? 1)
                    : (nextSequence.days_from_prev_step ?? 0);

            const scheduleResult = await scheduleDateTime({
                baseDate: previousActivityDate,
                customerCountry: customer.Country?.iso2,
                customerState: customer.State?.iso2,
                timeOfDay: nextSequence.time_of_day,
                daysToAdd,
                isFirstStep: details.last_automated_step === 0,
            });

            customerMap.set(customerId, {
                schedule_time: scheduleResult.scheduledTime,
                schedule_calculation: scheduleResult.calculation,
            });
        } catch {
            /* skip customer on schedule error */
        }
    }

    return customerMap;
}
