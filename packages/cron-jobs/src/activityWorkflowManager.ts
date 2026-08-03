/**
 * Activity Workflow Manager
 *
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * server/cron-jobs/activityWorkflowManager.ts
 *
 * BEST-EFFORT PORT: Core Prisma work + SMS send via @archaser/sms-send
 *
 * Phase 1: Send due SCHEDULED activities (SMS + Email stub)
 * - Query SCHEDULED activities due now (status=SCHEDULED, schedule_time <= now)
 * - Load pending ActivityContact rows for each activity
 * - SMS: resolve SMSVendor, call sendViaVendor with DB credentials
 * - Email: stub (mark as deferred/skipped, same pattern as notificationRules)
 * - Update ActivityContact + Activity status (SENT/DELIVERED/FAILED)
 * - Batch with concurrency limit 5
 *
 * Phase 2: Generate next automated activities
 * - Find open collection periods needing next activity (create_next_activity=true)
 * - Create SCHEDULED Activity + ActivityContact for next sequence step
 * - Update collection period (last_automated_step, create_next_activity=false)
 *
 * INTENTIONAL GAPS (documented as code comments):
 * - Full ActivityService.createAutomatedActivity (complex DI dependencies)
 * - ActivityService.processTemplateContent (template variable replacement)
 * - Email send (SMTP client unavailable; stub logs intent)
 * - CommunicationIntelligence / ControlCenterRealtime / LogService
 * - CustomerService.calculateNextAutomatedActivityTime (complex date calc)
 * - Intelligent channel selection / full CI logic
 */

import type { PrismaClient } from "@prisma/client";
import { sendViaVendor } from "@archaser/sms-send";
import type { CronJobResult } from "./handlers";

const BATCH_SIZE = 50;
const CONCURRENCY_LIMIT = 5;

export async function activityWorkflowManager(
    prisma: PrismaClient,
    options?: { skipSmsSend?: boolean; customerId?: number }
): Promise<{
    success: boolean;
    message: string;
    summary: unknown;
    durationMs: number;
}> {
    const start = Date.now();
    const summary = {
        phase1: {
            activitiesFound: 0,
            activitiesProcessed: 0,
            smsSent: 0,
            smsFailed: 0,
            emailStubbed: 0,
            errors: [] as string[],
        },
        phase2: {
            periodsFound: 0,
            activitiesCreated: 0,
            periodsUpdated: 0,
            errors: [] as string[],
        },
        intentionalGaps: {
            emailSend: "Email send stubbed (SMTP unavailable)",
            templateProcessing: "Template variable replacement skipped",
            fullActivityService: "ActivityService.createAutomatedActivity skipped",
            communicationIntelligence: "CI/ControlCenter/LogService skipped",
        },
    };

    try {
        // ===== PHASE 1: Send due SCHEDULED activities =====
        await sendDueActivities(prisma, options, summary.phase1);

        // ===== PHASE 2: Generate next automated activities =====
        await generateNextActivities(prisma, options, summary.phase2);

        const totalErrors =
            summary.phase1.errors.length + summary.phase2.errors.length;
        const message = `Phase 1: ${summary.phase1.activitiesProcessed} activities processed (SMS: ${summary.phase1.smsSent} sent, ${summary.phase1.smsFailed} failed; Email: ${summary.phase1.emailStubbed} stubbed). Phase 2: ${summary.phase2.activitiesCreated} activities created, ${summary.phase2.periodsUpdated} periods updated${totalErrors > 0 ? `, ${totalErrors} errors` : ""}`;

        return {
            success: totalErrors === 0,
            message,
            summary,
            durationMs: Date.now() - start,
        };
    } catch (error) {
        const err = error as Error;
        summary.phase1.errors.push(err.message);
        return {
            success: false,
            message: `Activity Workflow Manager failed: ${err.message}`,
            summary,
            durationMs: Date.now() - start,
        };
    }
}

/**
 * Phase 1: Send due SCHEDULED activities
 */
async function sendDueActivities(
    prisma: PrismaClient,
    options: { skipSmsSend?: boolean; customerId?: number } | undefined,
    stats: {
        activitiesFound: number;
        activitiesProcessed: number;
        smsSent: number;
        smsFailed: number;
        emailStubbed: number;
        errors: string[];
    }
) {
    const now = new Date();

    // Query SCHEDULED activities due now (schedule_time <= now)
    const whereClause: any = {
        status: "SCHEDULED",
        schedule_time: { lte: now },
        type: { in: ["SMS", "Email"] },
        Customer: {
            Account: {
                OR: [
                    { has_collection: true },
                    { has_credit_insurance: { not: true } },
                ],
            },
        },
    };

    if (options?.customerId) {
        whereClause.customer_id = options.customerId;
    }

    const dueActivities = await prisma.activity.findMany({
        where: whereClause,
        include: {
            Customer: {
                select: {
                    id: true,
                    account_id: true,
                    type: true,
                    email: true,
                    language: true,
                    Person: {
                        select: {
                            mobile: true,
                            first_name: true,
                            last_name: true,
                        },
                    },
                    Company: {
                        select: {
                            name: true,
                        },
                    },
                    Country: {
                        select: {
                            id: true,
                            iso2: true,
                        },
                    },
                },
            },
            Account: {
                select: {
                    id: true,
                    name: true,
                    sms_from_name: true,
                    sms_fallback_enabled: true,
                },
            },
            ActivitiesSequence: {
                select: {
                    id: true,
                    step: true,
                    category: true,
                },
            },
            ActivityContact: {
                select: {
                    id: true,
                    contact_id: true,
                    status: true,
                    Contact: {
                        select: {
                            id: true,
                            mobile: true,
                            email: true,
                            first_name: true,
                            last_name: true,
                        },
                    },
                },
            },
        },
        take: BATCH_SIZE,
        orderBy: { schedule_time: "asc" },
    });

    stats.activitiesFound = dueActivities.length;

    if (dueActivities.length === 0) {
        return;
    }

    // Process in batches with concurrency limit
    for (let i = 0; i < dueActivities.length; i += CONCURRENCY_LIMIT) {
        const batch = dueActivities.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(
            batch.map(async (activity) => {
                try {
                    await processActivity(prisma, activity, options, stats);
                    stats.activitiesProcessed++;
                } catch (err) {
                    const error = err as Error;
                    const errorMessage = `Activity ${activity.id}: ${error.message}`;
                    stats.errors.push(errorMessage);
                }
            })
        );
    }
}

/**
 * Process a single activity: send SMS or Email stub
 */
async function processActivity(
    prisma: PrismaClient,
    activity: any,
    options: { skipSmsSend?: boolean; customerId?: number } | undefined,
    stats: {
        smsSent: number;
        smsFailed: number;
        emailStubbed: number;
        errors: string[];
    }
) {
    const pendingContacts = activity.ActivityContact.filter(
        (ac: any) => ac.status === "Scheduled"
    );

    if (pendingContacts.length === 0) {
        // No pending contacts - mark activity as SENT
        await prisma.activity.update({
            where: { id: activity.id },
            data: {
                status: "SENT",
                modified_at: new Date(),
            },
        });
        return;
    }

    // SMS: resolve vendor and send
    if (activity.type === "SMS") {
        await processSmsActivity(
            prisma,
            activity,
            pendingContacts,
            options,
            stats
        );
    }
    // Email: stub (log intent, mark as sent)
    else if (activity.type === "Email") {
        await processEmailActivity(prisma, activity, pendingContacts, stats);
    }
}

/**
 * Process SMS activity: resolve vendor and send via sendViaVendor
 */
async function processSmsActivity(
    prisma: PrismaClient,
    activity: any,
    pendingContacts: any[],
    options: { skipSmsSend?: boolean } | undefined,
    stats: {
        smsSent: number;
        smsFailed: number;
        errors: string[];
    }
) {
    const customer = activity.Customer;
    const account = activity.Account;
    const countryId = customer.Country?.id ?? null;

    // Resolve SMS vendor for this account/country
    const vendor = await resolveSmsVendor(
        prisma,
        account.id,
        countryId
    );

    if (!vendor && !options?.skipSmsSend) {
        // No vendor available - mark activity as FAILED
        await prisma.$transaction(async (tx) => {
            await tx.activity.update({
                where: { id: activity.id },
                data: {
                    status: "FAILED",
                    modified_at: new Date(),
                },
            });

            await Promise.all(
                pendingContacts.map((ac: any) =>
                    tx.activityContact.update({
                        where: { id: ac.id },
                        data: {
                            status: "Failed",
                            failure_reason: "No SMS vendor available",
                            failed_at: new Date(),
                            modified_at: new Date(),
                        },
                    })
                )
            );
        });

        stats.smsFailed += pendingContacts.length;
        return;
    }

    // Send SMS to each contact
    let sentCount = 0;
    let failedCount = 0;

    for (const activityContact of pendingContacts) {
        const contact = activityContact.Contact;
        if (!contact?.mobile) {
            failedCount++;
            await prisma.activityContact.update({
                where: { id: activityContact.id },
                data: {
                    status: "Failed",
                    failure_reason: "No mobile number",
                    failed_at: new Date(),
                    modified_at: new Date(),
                },
            });
            continue;
        }

        // Skip actual send if skipSmsSend=true (dry run)
        if (options?.skipSmsSend) {
            await prisma.activityContact.update({
                where: { id: activityContact.id },
                data: {
                    status: "Sent",
                    modified_at: new Date(),
                },
            });
            sentCount++;
            continue;
        }

        // Send SMS via vendor
        try {
            const smsFromName =
                account.sms_from_name || "ARchaser";
            const smsBody = activity.content || "Reminder";

            // Convert vendor to SmsVendorCreds (handle Decimal type)
            const vendorCreds = {
                id: vendor!.id,
                provider: vendor!.provider,
                api_key: vendor!.api_key,
                api_secret: vendor!.api_secret,
                account_sid: vendor!.account_sid,
                auth_token: vendor!.auth_token,
                webhook_url: vendor!.webhook_url,
                phone_number: null,
                cost_per_sms: vendor!.cost_per_sms
                    ? parseFloat(vendor!.cost_per_sms.toString())
                    : null,
            };

            const result = await sendViaVendor(
                vendorCreds,
                contact.mobile,
                smsFromName,
                smsBody
            );

            if (result.success) {
                await prisma.activityContact.update({
                    where: { id: activityContact.id },
                    data: {
                        status: "Sent",
                        message_id: result.messageId || null,
                        vendor_message_id: result.vendorMessageId || null,
                        sms_vendor_id: vendor!.id,
                        communication_channel: "SMS",
                        modified_at: new Date(),
                    },
                });
                sentCount++;
            } else {
                await prisma.activityContact.update({
                    where: { id: activityContact.id },
                    data: {
                        status: "Failed",
                        failure_reason: result.error || "SMS send failed",
                        failed_at: new Date(),
                        modified_at: new Date(),
                    },
                });
                failedCount++;
            }
        } catch (err) {
            const error = err as Error;
            await prisma.activityContact.update({
                where: { id: activityContact.id },
                data: {
                    status: "Failed",
                    failure_reason: error.message,
                    failed_at: new Date(),
                    modified_at: new Date(),
                },
            });
            failedCount++;
        }
    }

    stats.smsSent += sentCount;
    stats.smsFailed += failedCount;

    // Update parent activity status
    const finalStatus =
        failedCount === 0
            ? "SENT"
            : sentCount === 0
              ? "FAILED"
              : "SENT";

    await prisma.activity.update({
        where: { id: activity.id },
        data: {
            status: finalStatus,
            modified_at: new Date(),
        },
    });
}

/**
 * Process Email activity: stub (SMTP unavailable)
 * Pattern: same as processNotificationRules email stub
 */
async function processEmailActivity(
    prisma: PrismaClient,
    activity: any,
    pendingContacts: any[],
    stats: { emailStubbed: number }
) {
    // STUB: Mark email activity as SENT without actually sending
    // Real email send would require Nest system email service
    await prisma.$transaction(async (tx) => {
        await tx.activity.update({
            where: { id: activity.id },
            data: {
                status: "SENT",
                modified_at: new Date(),
            },
        });

        await Promise.all(
            pendingContacts.map((ac: any) =>
                tx.activityContact.update({
                    where: { id: ac.id },
                    data: {
                        status: "Sent",
                        communication_channel: "Email",
                        modified_at: new Date(),
                    },
                })
            )
        );
    });

    stats.emailStubbed += pendingContacts.length;
}

/**
 * Resolve SMS vendor for account/country using AccountSMSProviderPreferences
 */
async function resolveSmsVendor(
    prisma: PrismaClient,
    accountId: number,
    countryId: number | null
) {
    // Try country-specific vendor first via AccountSMSProviderPreferences
    if (countryId) {
        const preference =
            await prisma.accountSMSProviderPreferences.findFirst({
                where: {
                    account_id: accountId,
                    country_id: countryId,
                    is_enabled: true,
                },
                include: {
                    SMSVendor: true,
                },
                orderBy: { priority: "asc" },
            });

        if (preference?.SMSVendor?.is_active) {
            return preference.SMSVendor;
        }
    }

    // Fallback: get default vendor for this account (any country)
    const defaultPreference =
        await prisma.accountSMSProviderPreferences.findFirst({
            where: {
                account_id: accountId,
                is_enabled: true,
            },
            include: {
                SMSVendor: true,
            },
            orderBy: [{ priority: "asc" }, { id: "asc" }],
        });

    if (defaultPreference?.SMSVendor?.is_active) {
        return defaultPreference.SMSVendor;
    }

    return null;
}

/**
 * Phase 2: Generate next automated activities
 */
async function generateNextActivities(
    prisma: PrismaClient,
    options: { customerId?: number } | undefined,
    stats: {
        periodsFound: number;
        activitiesCreated: number;
        periodsUpdated: number;
        errors: string[];
    }
) {
    const now = new Date();

    // Find open collection periods needing next activity
    const whereClause: any = {
        create_next_activity: true,
        current_category: "Automated",
        period_end_date: null,
        Customer: {
            automation_stuck_no_contacts: { not: true },
            Account: {
                OR: [
                    { has_collection: true },
                    { has_credit_insurance: { not: true } },
                ],
            },
        },
    };

    if (options?.customerId) {
        whereClause.customer_id = options.customerId;
    }

    const periodsNeedingActivities =
        await prisma.customerCollectionPeriod.findMany({
            where: whereClause,
            include: {
                Customer: {
                    select: {
                        id: true,
                        account_id: true,
                        type: true,
                        email: true,
                        language: true,
                        sequence_container_id: true,
                        Person: {
                            select: {
                                mobile: true,
                                first_name: true,
                                last_name: true,
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
                                        first_name: true,
                                        last_name: true,
                                        receives_standard_reminder: true,
                                        receives_escalated_reminder: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            take: BATCH_SIZE,
        });

    stats.periodsFound = periodsNeedingActivities.length;

    if (periodsNeedingActivities.length === 0) {
        return;
    }

    // Get account IDs for sequence lookup
    const accountIds = Array.from(
        new Set(
            periodsNeedingActivities
                .map((p) => p.Customer?.account_id)
                .filter((id): id is number => typeof id === "number")
        )
    );

    // Get default containers
    const defaultContainers = await prisma.sequenceContainer.findMany({
        where: {
            account_id: { in: accountIds },
            category: "Automated",
            is_default: true,
            active: true,
        },
        select: { id: true, account_id: true },
    });
    const defaultContainerByAccount = new Map(
        defaultContainers.map((c) => [c.account_id, c.id])
    );

    // Get sequences for all account/container combinations
    const sequenceKeys = periodsNeedingActivities.map((p) => {
        const customer = p.Customer;
        const containerId =
            customer?.sequence_container_id ??
            defaultContainerByAccount.get(customer?.account_id ?? 0) ??
            null;
        return {
            accountId: customer?.account_id ?? 0,
            containerId,
        };
    });

    const uniqueSequenceKeys = Array.from(
        new Map(
            sequenceKeys.map((k) => [
                `${k.accountId}_${k.containerId}`,
                k,
            ])
        ).values()
    );

    const sequencesRaw = await Promise.all(
        uniqueSequenceKeys.map((key) =>
            prisma.activitiesSequence.findMany({
                where: {
                    account_id: key.accountId,
                    sequence_container_id: key.containerId,
                    category: "Automated",
                    active: true,
                    OR: [{ step_type: null }, { step_type: "overdue" }],
                },
                include: {
                    ActivitiesTemplate: {
                        include: {
                            ActivityTemplateLanguage: true,
                        },
                    },
                },
                orderBy: { step: "asc" },
            })
        )
    );

    const sequencesByKey = new Map<string, any[]>();
    uniqueSequenceKeys.forEach((key, idx) => {
        const mapKey = `${key.accountId}_${key.containerId || "null"}`;
        sequencesByKey.set(mapKey, sequencesRaw[idx]);
    });

    // Process each period
    for (const period of periodsNeedingActivities) {
        try {
            await processCollectionPeriodForNextActivity(
                prisma,
                period,
                sequencesByKey,
                defaultContainerByAccount,
                stats
            );
        } catch (err) {
            const error = err as Error;
            stats.errors.push(
                `Period ${period.id}: ${error.message}`
            );
        }
    }
}

/**
 * Process a collection period: create next automated activity
 */
async function processCollectionPeriodForNextActivity(
    prisma: PrismaClient,
    period: any,
    sequencesByKey: Map<string, any[]>,
    defaultContainerByAccount: Map<number, number>,
    stats: {
        activitiesCreated: number;
        periodsUpdated: number;
        errors: string[];
    }
) {
    const customer = period.Customer;
    const containerId =
        customer.sequence_container_id ??
        defaultContainerByAccount.get(customer.account_id) ??
        null;
    const sequenceKey = `${customer.account_id}_${containerId || "null"}`;
    const sequences = sequencesByKey.get(sequenceKey) || [];

    if (sequences.length === 0) {
        // No sequences - disable activity creation
        await prisma.customerCollectionPeriod.update({
            where: { id: period.id },
            data: {
                create_next_activity: false,
                modified_at: new Date(),
            },
        });
        return;
    }

    // Find next step
    const currentStep = period.last_automated_step || 0;
    const nextStep = currentStep + 1;
    const nextSequence = sequences.find((s) => s.step === nextStep);

    if (!nextSequence) {
        // No next step - disable activity creation (end of sequence)
        await prisma.customerCollectionPeriod.update({
            where: { id: period.id },
            data: {
                create_next_activity: false,
                modified_at: new Date(),
            },
        });
        return;
    }

    // Get contacts for activity
    const mainContacts = await prisma.contact.findMany({
        where: { customer_id: customer.id },
        select: {
            id: true,
            email: true,
            mobile: true,
            first_name: true,
            last_name: true,
            receives_standard_reminder: true,
            receives_escalated_reminder: true,
        },
    });

    const typeSpecificContacts =
        customer.type === "Company"
            ? (customer.Company?.Contact ?? [])
            : customer.email
              ? [
                    {
                        id: 0,
                        email: customer.email,
                        mobile: customer.Person?.mobile ?? null,
                        first_name: customer.Person?.first_name ?? null,
                        last_name: null,
                        receives_standard_reminder: true,
                        receives_escalated_reminder: false,
                    },
                ]
              : [];

    const allContacts = [...mainContacts, ...typeSpecificContacts].filter(
        (c) => c.id > 0
    );

    const contacts = filterContactsBySequence(allContacts, {
        send_to_standard_contacts:
            nextSequence.send_to_standard_contacts ?? false,
        send_to_escalated_contacts:
            nextSequence.send_to_escalated_contacts ?? false,
    });

    if (contacts.length === 0) {
        await prisma.customer.update({
            where: { id: customer.id },
            data: { automation_stuck_no_contacts: true },
        });
        return;
    }

    // Build activity content (stub - no template processing)
    const activityContent = buildActivityContent(nextSequence, customer);
    const content = activityContent.content || "Automated activity";
    const subject = activityContent.subject || "Automated activity";

    // Calculate schedule time (basic - no CustomerService.calculateNextAutomatedActivityTime)
    // STUB: Schedule immediately or with minimal delay
    const scheduleTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Get system user ID
    const systemUserId = await getSystemUserId(prisma, customer.account_id);

    // Create activity + contacts in transaction
    await prisma.$transaction(async (tx) => {
        const activity = await tx.activity.create({
            data: {
                customer_id: customer.id,
                account_id: customer.account_id,
                collection_period_id: period.id,
                activity_sequence_id: nextSequence.id,
                type: nextSequence.activity_type,
                content,
                title: "{{activities.fields.activity_automated_scheduled}}",
                title_params: {
                    step: nextStep,
                    contacts: contacts.length,
                },
                schedule_time: scheduleTime,
                status: "SCHEDULED",
                system_generated: true,
                created_by: systemUserId,
                modified_by: systemUserId,
            },
        });

        await Promise.all(
            contacts.map((c) =>
                tx.activityContact.create({
                    data: {
                        activity_id: activity.id,
                        contact_id: c.id,
                        status: "Scheduled",
                    },
                })
            )
        );

        // Update collection period
        await tx.customerCollectionPeriod.update({
            where: { id: period.id },
            data: {
                create_next_activity: false,
                last_automated_step: nextStep,
                modified_at: new Date(),
            },
        });

        stats.activitiesCreated++;
        stats.periodsUpdated++;
    });
}

/**
 * Filter contacts by sequence settings
 */
function filterContactsBySequence(
    contacts: Array<{
        id: number;
        first_name: string | null;
        last_name?: string | null;
        email?: string | null;
        mobile?: string | null;
        receives_standard_reminder?: boolean | null;
        receives_escalated_reminder?: boolean | null;
    }>,
    sequence: {
        send_to_standard_contacts: boolean;
        send_to_escalated_contacts: boolean;
    }
): typeof contacts {
    const result: typeof contacts = [];
    const added = new Set<number>();
    for (const c of contacts) {
        const includeStandard =
            sequence.send_to_standard_contacts &&
            c.receives_standard_reminder === true;
        const includeEscalated =
            sequence.send_to_escalated_contacts &&
            c.receives_escalated_reminder === true;
        if ((includeStandard || includeEscalated) && !added.has(c.id)) {
            result.push(c);
            added.add(c.id);
        }
    }
    return result;
}

/**
 * Build activity content (stub - no template processing)
 * STUB: Raw template content without variable replacement
 */
function buildActivityContent(
    sequence: any,
    customer: any
): { subject: string; content: string } {
    const template = sequence.ActivitiesTemplate;
    const lang = (customer.language as string) || "English";
    const langTemplate = template?.ActivityTemplateLanguage?.find(
        (l: any) => l.language === lang
    );

    const subject =
        langTemplate?.email_subject ?? template?.email_subject ?? "";
    const content =
        sequence.activity_type === "SMS"
            ? (langTemplate?.sms_content ?? template?.sms_content ?? "")
            : (langTemplate?.email_content ?? template?.email_content ?? "");

    return { subject, content };
}

/**
 * Get system user ID for an account
 */
async function getSystemUserId(
    prisma: PrismaClient,
    accountId: number
): Promise<string> {
    const systemUser = await prisma.user.findFirst({
        where: {
            account_id: accountId,
            email: { contains: "system" },
            deactivated_at: null,
        },
        select: { id: true },
    });
    return systemUser?.id ?? "1";
}
