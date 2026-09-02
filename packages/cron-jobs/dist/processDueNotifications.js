"use strict";
/**
 * Process Due Notifications
 *
 * Sends notifications for invoices that are due (or due in N days) based on
 * ActivitiesSequence steps with step_type='due' and days_before_due.
 *
 * Creates SCHEDULED activities; channel send handled by Activity Workflow Manager.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.processDueNotifications = processDueNotifications;
const scheduleDateTime_1 = require("./scheduling/scheduleDateTime");
const processTemplateContent_1 = require("./templates/processTemplateContent");
const getSystemUserId_1 = require("./users/getSystemUserId");
const cronFrozenAccountGuard_1 = require("./accountFreeze/cronFrozenAccountGuard");
const BATCH_SIZE = 100;
const LOOK_AHEAD_DAYS = 15; // Pre-create activities for invoices due within the next 15 days
async function processDueNotifications(prisma, options) {
    const start = Date.now();
    const stats = {
        processed: 0,
        sent: 0,
        skipped: 0,
        errors: [],
    };
    try {
        const now = new Date();
        // Use UTC for "today" so nearest-only filter and invoice window align regardless of server TZ
        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
        const lookAheadEnd = new Date(today);
        lookAheadEnd.setUTCDate(lookAheadEnd.getUTCDate() + LOOK_AHEAD_DAYS);
        lookAheadEnd.setUTCHours(23, 59, 59, 999);
        // 1. Get all due steps from Automated sequences
        let customerAccountId;
        if (options?.customerId) {
            const customer = await prisma.customer.findUnique({
                where: { id: options.customerId },
                select: { account_id: true },
            });
            customerAccountId = customer?.account_id ?? undefined;
        }
        const dueStepsRaw = await prisma.activitiesSequence.findMany({
            where: {
                category: "Automated",
                active: true,
                step_type: "due",
                days_before_due: { not: null },
                ...(customerAccountId
                    ? { account_id: customerAccountId }
                    : {}),
            },
            include: {
                ActivitiesTemplate: {
                    include: {
                        ActivityTemplateLanguage: true,
                    },
                },
            },
            orderBy: { days_before_due: "desc" },
        });
        const { kept: dueSteps, skippedAccountIds } = options?.freeze
            ? (0, cronFrozenAccountGuard_1.partitionByFrozenAccount)(dueStepsRaw, options.freeze.frozenAccountIds)
            : { kept: dueStepsRaw, skippedAccountIds: [] };
        if (options?.freeze && skippedAccountIds.length > 0) {
            options.freeze.reportSkips(skippedAccountIds);
        }
        if (dueSteps.length === 0) {
            return {
                success: true,
                message: "No due notification steps configured",
                summary: stats,
                durationMs: Date.now() - start,
            };
        }
        const accountIds = Array.from(new Set(dueSteps.map((s) => s.account_id)));
        const defaultContainers = await prisma.sequenceContainer.findMany({
            where: {
                account_id: { in: accountIds },
                category: "Automated",
                is_default: true,
                active: true,
            },
            select: { id: true, account_id: true },
        });
        const defaultContainerByAccount = new Map(defaultContainers.map((c) => [c.account_id, c.id]));
        // 2. For each due step, find invoices due within the look-ahead window
        for (const step of dueSteps) {
            const daysBeforeDue = step.days_before_due ?? 0;
            // Invoice due date range: today through today + LOOK_AHEAD_DAYS (UTC)
            const earliestInvoiceDueDate = new Date(today);
            const latestInvoiceDueDate = new Date(lookAheadEnd);
            const invoicesRaw = await prisma.invoice.findMany({
                where: {
                    status: "Due",
                    outstanding_debt: { gt: 0 },
                    due_date: {
                        gte: earliestInvoiceDueDate,
                        lte: latestInvoiceDueDate,
                    },
                    customer_id: options?.customerId ?? { not: null },
                    Customer: {
                        account_id: step.account_id,
                    },
                },
                include: {
                    Customer: {
                        select: {
                            id: true,
                            account_id: true,
                            type: true,
                            email: true,
                            customer_uuid: true,
                            language: true,
                            sequence_container_id: true,
                            Person: {
                                select: {
                                    first_name: true,
                                    last_name: true,
                                    mobile: true,
                                },
                            },
                            Company: {
                                select: {
                                    name: true,
                                    Contact: {
                                        select: {
                                            id: true,
                                            email: true,
                                            mobile: true,
                                            status: true,
                                            first_name: true,
                                            last_name: true,
                                            phone: true,
                                            receives_standard_reminder: true,
                                            receives_escalated_reminder: true,
                                        },
                                    },
                                },
                            },
                            country_id: true,
                            Country: { select: { iso2: true } },
                            State: { select: { iso2: true } },
                        },
                    },
                    Account: {
                        select: {
                            id: true,
                            name: true,
                            logo: true,
                            sub_domain: true,
                            sms_fallback_enabled: true,
                            sms_from_name: true,
                        },
                    },
                },
                orderBy: [{ due_date: "asc" }, { id: "asc" }],
                take: BATCH_SIZE,
            });
            // Exclude invoices that already have this due step, except "skip_due_to_dispute" (re-evaluate after dispute resolution)
            const stepKey = String(step.id);
            const invoices = invoicesRaw.filter((inv) => {
                const state = inv.due_notification_state;
                const stepState = state?.[stepKey];
                return (stepState === undefined ||
                    stepState === "skip_due_to_dispute");
            });
            if (invoices.length === 0) {
                continue;
            }
            // Group invoices by customer AND notification send date
            const invoicesByCustomerAndDate = new Map();
            for (const invoice of invoices) {
                if (!invoice.customer_id || !invoice.due_date)
                    continue;
                // Calculate the notification send date for this invoice (UTC for consistent todayKey match)
                const notificationDate = new Date(invoice.due_date);
                notificationDate.setUTCDate(notificationDate.getUTCDate() - daysBeforeDue);
                const dateKey = notificationDate.toISOString().split("T")[0];
                // Create a composite key: customer_id + notification_date
                const groupKey = `${invoice.customer_id}_${dateKey}`;
                const groupInvoices = invoicesByCustomerAndDate.get(groupKey) || [];
                groupInvoices.push(invoice);
                invoicesByCustomerAndDate.set(groupKey, groupInvoices);
            }
            // Nearest notification > now: one group per customer whose schedule_time is the smallest that is still > now
            const nowTime = new Date();
            const groupsByCustomer = new Map();
            for (const [groupKey, groupInvoices,] of invoicesByCustomerAndDate.entries()) {
                const customerIdNum = groupInvoices[0]?.customer_id;
                if (customerIdNum == null)
                    continue;
                const dateKey = groupKey.substring(groupKey.indexOf("_") + 1);
                if (!groupsByCustomer.has(customerIdNum)) {
                    groupsByCustomer.set(customerIdNum, []);
                }
                groupsByCustomer
                    .get(customerIdNum)
                    .push({ dateKey, invoices: groupInvoices });
            }
            for (const [, groupList] of groupsByCustomer.entries()) {
                groupList.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
            }
            for (const [customerIdNum, groupList,] of groupsByCustomer.entries()) {
                const firstGroup = groupList[0];
                const customer = firstGroup.invoices[0]?.Customer;
                if (!customer) {
                    stats.skipped += groupList.reduce((s, g) => s + g.invoices.length, 0);
                    continue;
                }
                const stepContainerId = step.sequence_container_id;
                const customerContainerId = customer.sequence_container_id;
                if (stepContainerId !== null) {
                    const defaultContainerId = defaultContainerByAccount.get(step.account_id);
                    const customerUsesStepContainer = customerContainerId === stepContainerId ||
                        (customerContainerId === null &&
                            defaultContainerId === stepContainerId);
                    if (!customerUsesStepContainer) {
                        const skipped = groupList.reduce((s, g) => s + g.invoices.length, 0);
                        stats.skipped += skipped;
                        continue;
                    }
                }
                let processed = false;
                for (const { dateKey, invoices: customerInvoices } of groupList) {
                    const [y, m, d] = dateKey.split("-").map(Number);
                    const notificationSendDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
                    // Calculate schedule time with timezone/weekend parity
                    let scheduledTime;
                    if (options?.fastForwardScheduledActivities) {
                        scheduledTime = new Date(Date.now() - 60 * 60 * 1000);
                    }
                    else {
                        const scheduleResult = await (0, scheduleDateTime_1.scheduleDateTime)({
                            baseDate: notificationSendDate,
                            timeOfDay: step.time_of_day ?? "09:00",
                            customerCountry: customer.Country?.iso2,
                            customerState: customer.State?.iso2,
                            preserveInputDate: true,
                            daysToAdd: 0,
                        });
                        scheduledTime = scheduleResult.scheduledTime;
                    }
                    if (!options?.fastForwardScheduledActivities &&
                        scheduledTime <= nowTime)
                        continue;
                    try {
                        const result = await processInvoicesForDueStep(prisma, customerInvoices, step, scheduledTime);
                        stats.processed += customerInvoices.length;
                        stats.sent += result.sentCount;
                        stats.skipped += result.skippedCount;
                        processed = true;
                        break;
                    }
                    catch (err) {
                        const error = err;
                        const errorMessage = `Customer ${customerIdNum}: ${error.message}`;
                        stats.errors.push(errorMessage);
                    }
                }
                if (!processed) {
                    stats.skipped += groupList.reduce((s, g) => s + g.invoices.length, 0);
                }
            }
        }
        const message = `Processed ${stats.processed}, sent ${stats.sent}, skipped ${stats.skipped}${stats.errors.length > 0 ? `, ${stats.errors.length} errors` : ""}`;
        return {
            success: stats.errors.length === 0,
            message,
            summary: stats,
            durationMs: Date.now() - start,
        };
    }
    catch (error) {
        const err = error;
        stats.errors.push(err.message);
        return {
            success: false,
            message: `Due notification processing failed: ${err.message}`,
            summary: stats,
            durationMs: Date.now() - start,
        };
    }
}
/**
 * Process invoices for a due step and create SCHEDULED activities.
 * Activities will be sent later by activityWorkflowManager when schedule_time arrives.
 */
async function processInvoicesForDueStep(prisma, invoices, step, scheduledTime) {
    const customer = invoices[0]?.Customer;
    if (!customer)
        return { sent: false, sentCount: 0, skippedCount: invoices.length };
    const invoicesToProcess = [];
    let skippedCount = 0;
    for (const invoice of invoices) {
        if ((invoice.outstanding_debt ?? 0) <= 0) {
            skippedCount++;
            continue;
        }
        invoicesToProcess.push(invoice);
    }
    if (invoicesToProcess.length === 0) {
        return { sent: false, sentCount: 0, skippedCount };
    }
    const mainInvoice = invoicesToProcess[0];
    const invoiceNumbers = invoicesToProcess
        .map((i) => i.invoice_number)
        .join(", ");
    const totalOutstandingDebt = invoicesToProcess.reduce((sum, i) => sum + (i.outstanding_debt ?? 0), 0);
    const mainContacts = await prisma.contact.findMany({
        where: { customer_id: customer.id },
        select: {
            id: true,
            email: true,
            mobile: true,
            first_name: true,
            last_name: true,
            phone: true,
            receives_standard_reminder: true,
            receives_escalated_reminder: true,
        },
    });
    const typeSpecificContacts = customer.type === "Company"
        ? (customer.Company?.Contact ?? [])
        : customer.email
            ? [
                {
                    id: 0,
                    email: customer.email,
                    mobile: customer.Person?.mobile ?? null,
                    first_name: customer.Person?.first_name ?? null,
                    last_name: null,
                    phone: null,
                    receives_standard_reminder: true,
                    receives_escalated_reminder: false,
                },
            ]
            : [];
    const allContacts = [...mainContacts, ...typeSpecificContacts].filter((c) => c.id > 0);
    const contacts = filterContactsBySequence(allContacts, {
        send_to_standard_contacts: step.send_to_standard_contacts ?? false,
        send_to_escalated_contacts: step.send_to_escalated_contacts ?? false,
    });
    if (contacts.length === 0) {
        await prisma.customer.update({
            where: { id: customer.id },
            data: { automation_stuck_no_contacts: true },
        });
        return {
            sent: false,
            sentCount: 0,
            skippedCount: skippedCount + invoicesToProcess.length,
        };
    }
    // Calculate the notification send date (UTC)
    const notificationSendDate = new Date(mainInvoice.due_date);
    notificationSendDate.setUTCDate(notificationSendDate.getUTCDate() - (step.days_before_due ?? 0));
    notificationSendDate.setUTCHours(0, 0, 0, 0);
    const nowUtc = new Date();
    nowUtc.setUTCHours(0, 0, 0, 0);
    if (notificationSendDate < nowUtc) {
        return {
            sent: false,
            sentCount: 0,
            skippedCount: skippedCount + invoicesToProcess.length,
        };
    }
    // Check for existing SCHEDULED activity (same customer, step, schedule date) to merge into
    const scheduleUtcDate = new Date(Date.UTC(scheduledTime.getUTCFullYear(), scheduledTime.getUTCMonth(), scheduledTime.getUTCDate()));
    const scheduleUtcDateEnd = new Date(scheduleUtcDate);
    scheduleUtcDateEnd.setUTCDate(scheduleUtcDateEnd.getUTCDate() + 1);
    const existingActivity = await prisma.activity.findFirst({
        where: {
            customer_id: customer.id,
            activity_sequence_id: step.id,
            status: "SCHEDULED",
            schedule_time: {
                gte: scheduleUtcDate,
                lt: scheduleUtcDateEnd,
            },
        },
    });
    if (existingActivity) {
        return mergeInvoicesIntoDueActivity(prisma, existingActivity, invoicesToProcess, step, customer, contacts);
    }
    // Build raw template content (macro replacement at send time in AWM)
    const activityContent = (0, processTemplateContent_1.getRawTemplateContent)(step, customer.language);
    const content = activityContent.content || "Due notification";
    const systemUserId = await (0, getSystemUserId_1.getSystemUserId)(prisma, customer.account_id);
    if (!systemUserId) {
        throw new Error(`No active user found for account ${customer.account_id}`);
    }
    await prisma.$transaction(async (tx) => {
        const activity = await tx.activity.create({
            data: {
                customer_id: customer.id,
                account_id: customer.account_id,
                invoice_id: mainInvoice.id,
                activity_sequence_id: step.id,
                collection_period_id: null,
                type: step.activity_type,
                content,
                title: "{{activities.fields.activity_due_notification_scheduled}}",
                title_params: {
                    contacts: contacts.length,
                    invoiceNumber: invoiceNumbers,
                    count: invoicesToProcess.length,
                    totalAmount: totalOutstandingDebt,
                },
                schedule_time: scheduledTime,
                status: "SCHEDULED",
                system_generated: true,
                created_by: systemUserId,
                modified_by: systemUserId,
            },
        });
        const stepKey = String(step.id);
        await Promise.all(invoicesToProcess.map((inv) => {
            const current = inv.due_notification_state ??
                {};
            const next = { ...current, [stepKey]: "scheduled" };
            return tx.invoice.update({
                where: { id: inv.id },
                data: { due_notification_state: next },
            });
        }));
        await Promise.all(contacts.map((c) => tx.activityContact.create({
            data: {
                activity_id: activity.id,
                contact_id: c.id,
                status: "Scheduled",
            },
        })));
        return activity;
    });
    return {
        sent: true,
        sentCount: contacts.length,
        skippedCount,
    };
}
/**
 * Merge new invoices into an existing SCHEDULED due activity.
 */
async function mergeInvoicesIntoDueActivity(prisma, existingActivity, invoicesToProcess, step, customer, contacts) {
    const titleParams = existingActivity.title_params;
    const invoiceNumbersStr = titleParams?.invoiceNumber;
    const existingNumbers = invoiceNumbersStr
        ? invoiceNumbersStr
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    if (existingNumbers.length === 0) {
        return { sent: false, sentCount: 0, skippedCount: invoicesToProcess.length };
    }
    const existingInvoiceRecords = await prisma.invoice.findMany({
        where: {
            customer_id: customer.id,
            invoice_number: { in: existingNumbers },
        },
    });
    const seenIds = new Set();
    const combinedInvoices = [];
    for (const inv of existingInvoiceRecords) {
        if (!seenIds.has(inv.id)) {
            seenIds.add(inv.id);
            combinedInvoices.push(inv);
        }
    }
    for (const inv of invoicesToProcess) {
        if (!seenIds.has(inv.id)) {
            seenIds.add(inv.id);
            combinedInvoices.push(inv);
        }
    }
    const combinedInvoiceNumbers = combinedInvoices
        .map((i) => i.invoice_number)
        .join(", ");
    const totalOutstandingDebt = combinedInvoices.reduce((sum, i) => sum + (i.outstanding_debt ?? 0), 0);
    const mainInvoice = combinedInvoices[0];
    const activityContent = (0, processTemplateContent_1.getRawTemplateContent)(step, customer.language);
    const content = activityContent.content || "Due notification";
    await prisma.$transaction(async (tx) => {
        await tx.activity.update({
            where: { id: existingActivity.id },
            data: {
                content,
                title_params: {
                    contacts: contacts.length,
                    invoiceNumber: combinedInvoiceNumbers,
                    count: combinedInvoices.length,
                    totalAmount: totalOutstandingDebt,
                },
                invoice_id: mainInvoice.id,
            },
        });
        const stepKey = String(step.id);
        await Promise.all(invoicesToProcess.map((inv) => {
            const current = inv.due_notification_state ??
                {};
            const next = { ...current, [stepKey]: "scheduled" };
            return tx.invoice.update({
                where: { id: inv.id },
                data: { due_notification_state: next },
            });
        }));
    });
    return {
        sent: true,
        sentCount: contacts.length,
        skippedCount: 0,
    };
}
function filterContactsBySequence(contacts, sequence) {
    const result = [];
    const added = new Set();
    for (const c of contacts) {
        const includeStandard = sequence.send_to_standard_contacts &&
            c.receives_standard_reminder === true;
        const includeEscalated = sequence.send_to_escalated_contacts &&
            c.receives_escalated_reminder === true;
        if ((includeStandard || includeEscalated) && !added.has(c.id)) {
            result.push(c);
            added.add(c.id);
        }
    }
    return result;
}
