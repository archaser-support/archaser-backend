import { Injectable } from "@nestjs/common";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

@Injectable()
export class AlertDetailsService {
    constructor(private readonly db: DatabaseService) {}

    async getDetails(type: string, limitNum: number) {
        const currentTime = new Date();
        const twoHoursAgo = new Date(currentTime.getTime() - 2 * 60 * 60 * 1000);
        const fiveMinutesAgo = new Date(
            currentTime.getTime() - 5 * 60 * 1000
        );
        const oneHourAgo = new Date(currentTime.getTime() - 60 * 60 * 1000);
        const twentyFourHoursAgo = new Date(
            currentTime.getTime() - 24 * 60 * 60 * 1000
        );
        const sevenDaysAgo = new Date(
            currentTime.getTime() - 7 * 24 * 60 * 60 * 1000
        );

        switch (type) {
            case "automation_stuck_no_contacts": {
                const where = { automation_stuck_no_contacts: true };
                const [total, stuckCustomers] = await Promise.all([
                    this.db.customer.count({ where }),
                    this.db.customer.findMany({
                        where,
                    select: {
                        id: true,
                        customer_number: true,
                        email: true,
                            Account: { select: { name: true } },
                        CustomerCollectionPeriod: {
                            where: { period_end_date: null },
                            take: 1,
                            orderBy: { created_at: "desc" },
                            select: {
                                id: true,
                                current_category: true,
                                total_outstanding_amount: true,
                                period_start_date: true,
                                    create_next_activity: true,
                                },
                        },
                    },
                    take: limitNum,
                    orderBy: { id: "desc" },
                    }),
                ]);
                return serializeBigInt({
                    type,
                    count: total,
                    details: stuckCustomers.map((c) => {
                        const p = c.CustomerCollectionPeriod?.[0];
                        return {
                            account_name: c.Account?.name || "N/A",
                            customer_number:
                                c.customer_number || String(c.id),
                            customer_id: c.id,
                            customer_email: c.email || "N/A",
                            collection_period: p?.id ?? "N/A",
                            category: p?.current_category ?? "N/A",
                            outstanding_amount:
                                p?.total_outstanding_amount ?? null,
                            period_start: p?.period_start_date ?? null,
                            create_next_activity: p?.create_next_activity
                                ? "yes"
                                : "no",
                        };
                    }),
                    runbook: [
                        "1. Open the customer and add at least one contact with email/mobile matching sequence settings (standard/escalated).",
                        "2. After contacts are valid, clear automation_stuck_no_contacts (or wait for workflow to clear it) so create_next_activity can resume.",
                        "3. Grafana drilldown: Automation Stuck - No Contacts panel.",
                    ].join(" "),
                });
            }
            case "cron_jobs_overdue": {
                const where = {
                    active: true,
                    next_run_at: { lt: fiveMinutesAgo },
                };
                const [total, jobs] = await Promise.all([
                    this.db.cronJob.count({ where }),
                    this.db.cronJob.findMany({
                        where,
                        take: limitNum,
                        orderBy: { next_run_at: "asc" },
                        select: {
                            id: true,
                            name: true,
                            last_run_at: true,
                            next_run_at: true,
                            failure_count_30d: true,
                        },
                    }),
                ]);
                return serializeBigInt({
                    type,
                    count: total,
                    details: jobs.map((j) => ({
                        name: j.name,
                        last_run_at: j.last_run_at,
                        next_run_at: j.next_run_at,
                        failures_30d: j.failure_count_30d,
                    })),
                    runbook: [
                        "1. Check Cron Manager / ARchaser Cron dashboard for job failures and lock contention.",
                        "2. Confirm the worker/cron process is running and not stuck on a long job.",
                        "3. Grafana drilldown: Overdue Cron Jobs panel.",
                    ].join(" "),
                });
            }
            case "cron_jobs_not_run_24h": {
                const where = {
                        active: true,
                        OR: [
                        { last_run_at: { lt: twentyFourHoursAgo } },
                            { last_run_at: null },
                        ],
                };
                const [total, jobs] = await Promise.all([
                    this.db.cronJob.count({ where }),
                    this.db.cronJob.findMany({
                        where,
                        take: limitNum,
                        orderBy: { last_run_at: "asc" },
                        select: {
                            id: true,
                            name: true,
                            last_run_at: true,
                            next_run_at: true,
                            failure_count_30d: true,
                        },
                    }),
                ]);
                return serializeBigInt({
                    type,
                    count: total,
                    details: jobs.map((j) => ({
                        name: j.name,
                        last_run_at: j.last_run_at,
                        next_run_at: j.next_run_at,
                        failures_30d: j.failure_count_30d,
                    })),
                    runbook: [
                        "1. Verify cron worker is healthy and schedule intervals are correct.",
                        "2. Inspect CronJobExecution / application logs for repeated failures on these jobs.",
                        "3. Grafana drilldown: Jobs Not Run in 24h panel.",
                    ].join(" "),
                });
            }
            case "stuck_activities": {
                // Match archaser_activities_stuck (SCHEDULED, system_generated, >2h past schedule_time).
                const where = {
                    status: "SCHEDULED" as const,
                    schedule_time: { lt: twoHoursAgo },
                    system_generated: true,
                };
                const [total, activities] = await Promise.all([
                    this.db.activity.count({ where }),
                    this.db.activity.findMany({
                        where,
                    take: limitNum,
                    orderBy: { schedule_time: "asc" },
                    select: {
                        id: true,
                        type: true,
                        status: true,
                        schedule_time: true,
                        customer_id: true,
                            collection_period_id: true,
                            Customer: {
                                select: {
                                    customer_number: true,
                                    Account: { select: { name: true } },
                                },
                            },
                        },
                    }),
                ]);
                return serializeBigInt({
                    type,
                    count: total,
                    details: activities.map((a) => {
                        const hoursPast = a.schedule_time
                            ? Math.max(
                                  0,
                                  Math.round(
                                      (currentTime.getTime() -
                                          a.schedule_time.getTime()) /
                                          (60 * 60 * 1000)
                                  )
                              )
                            : null;
                        return {
                            account_name: a.Customer?.Account?.name || "N/A",
                            customer_number:
                                a.Customer?.customer_number ||
                                String(a.customer_id),
                            customer_id: a.customer_id,
                            activity_id_display: String(a.id),
                            collection_period: a.collection_period_id,
                            type: a.type,
                            status: a.status,
                            schedule_time: a.schedule_time,
                            hours_past_due: hoursPast,
                        };
                    }),
                    runbook: [
                        "1. Check Activity Workflow Manager Phase 1 (send due SCHEDULED activities) for errors.",
                        "2. Confirm email/SMS vendor connectivity and account sender config.",
                        "3. Grafana drilldown: Stuck Activities (Scheduled > 2h ago) panel.",
                    ].join(" "),
                });
            }
            case "periods_without_activities": {
                // Match archaser_periods_without_activities gauge.
                const where = {
                    period_end_date: null,
                    current_category: "Automated" as const,
                    OR: [
                        { next_activity_date: null },
                        { next_activity_date: { lt: twentyFourHoursAgo } },
                    ],
                    NOT: {
                        Activity: {
                            some: {
                                status: "SCHEDULED" as const,
                                ActivitiesSequence: {
                                    is: { category: "Automated" as const },
                                },
                            },
                        },
                    },
                };
                const [total, periods] = await Promise.all([
                    this.db.customerCollectionPeriod.count({ where }),
                    this.db.customerCollectionPeriod.findMany({
                        where,
                        take: limitNum,
                        orderBy: { next_activity_date: "asc" },
                        select: {
                            id: true,
                            next_activity_date: true,
                            period_start_date: true,
                            create_next_activity: true,
                            last_automated_step: true,
                            customer_id: true,
                            Customer: {
                                select: {
                                    id: true,
                                    customer_number: true,
                                    automation_stuck_no_contacts: true,
                                    account_id: true,
                                    Account: {
                                        select: {
                                            name: true,
                                            has_collection: true,
                                            has_credit_insurance: true,
                                        },
                                    },
                                },
                            },
                        },
                    }),
                ]);

                const accountIds = Array.from(
                    new Set(periods.map((p) => p.Customer.account_id))
                );
                const processingImports =
                    accountIds.length > 0
                        ? await this.db.importJob.findMany({
                              where: {
                                  account_id: { in: accountIds },
                                  status: "Processing",
                              },
                              select: { account_id: true },
                              distinct: ["account_id"],
                          })
                        : [];
                const importFrozenAccounts = new Set(
                    processingImports.map((row) => row.account_id)
                );

                return serializeBigInt({
                    type,
                    count: total,
                    details: periods.map((p) => {
                        const account = p.Customer.Account;
                        const creditOnly =
                            account.has_collection === false &&
                            account.has_credit_insurance === true;
                        const importFrozen = importFrozenAccounts.has(
                            p.Customer.account_id
                        );
                        let likely_cause = "no_scheduled_automated_activity";
                        if (p.Customer.automation_stuck_no_contacts) {
                            likely_cause = "stuck_no_contacts";
                        } else if (creditOnly) {
                            likely_cause = "credit_only_account_skipped";
                        } else if (importFrozen) {
                            likely_cause = "account_frozen_import";
                        } else if (!p.create_next_activity) {
                            likely_cause = "create_next_activity_false";
                        }

                        return {
                            account_name: account.name || "N/A",
                            customer_number:
                                p.Customer.customer_number ||
                                String(p.Customer.id),
                            customer_id: p.customer_id,
                            collection_period: p.id,
                            period_start: p.period_start_date,
                            next_activity_date: p.next_activity_date,
                            last_step: p.last_automated_step,
                            create_next_activity: p.create_next_activity
                                ? "yes"
                                : "no",
                            stuck_no_contacts: p.Customer
                                .automation_stuck_no_contacts
                                ? "yes"
                                : "no",
                            credit_only: creditOnly ? "yes" : "no",
                            import_frozen: importFrozen ? "yes" : "no",
                            likely_cause,
                        };
                    }),
                    runbook: [
                        "1. Check Process Automated Collection Periods and Activity Workflow Manager crons.",
                        "2. If create_next_activity=no, inspect why the period was not enabled for the next step.",
                        "3. If stuck_no_contacts/credit_only/import_frozen, fix that blocker first.",
                        "4. Grafana drilldown: Periods Without Activities panel.",
                    ].join(" "),
                });
            }
            case "overdue_activity_creation": {
                // Match metrics-updater overdueActivityCreation gauge.
                const where = {
                    period_end_date: null,
                    create_next_activity: true,
                    next_activity_date: { lt: currentTime },
                };
                const [total, periods] = await Promise.all([
                    this.db.customerCollectionPeriod.count({ where }),
                    this.db.customerCollectionPeriod.findMany({
                        where,
                        take: limitNum,
                        orderBy: { next_activity_date: "asc" },
                        select: {
                            id: true,
                            next_activity_date: true,
                            current_category: true,
                            last_automated_step: true,
                            customer_id: true,
                            Customer: {
                                select: {
                                    id: true,
                                    customer_number: true,
                                    automation_stuck_no_contacts: true,
                                    account_id: true,
                                    Account: {
                                        select: {
                                            name: true,
                                            has_collection: true,
                                            has_credit_insurance: true,
                                        },
                                    },
                                },
                            },
                            Activity: {
                                where: {
                                    status: "SCHEDULED",
                                    ActivitiesSequence: {
                                        category: "Automated",
                                    },
                                },
                                take: 1,
                                select: { id: true },
                            },
                        },
                    }),
                ]);

                const accountIds = Array.from(
                    new Set(periods.map((p) => p.Customer.account_id))
                );
                const processingImports =
                    accountIds.length > 0
                        ? await this.db.importJob.findMany({
                              where: {
                                  account_id: { in: accountIds },
                                  status: "Processing",
                              },
                              select: { account_id: true },
                              distinct: ["account_id"],
                          })
                        : [];
                const importFrozenAccounts = new Set(
                    processingImports.map((row) => row.account_id)
                );

                const activeUsers =
                    accountIds.length > 0
                        ? await this.db.user.findMany({
                              where: {
                                  account_id: { in: accountIds },
                                  deactivated_at: null,
                              },
                              select: { account_id: true },
                              distinct: ["account_id"],
                          })
                        : [];
                const accountsWithActiveUser = new Set(
                    activeUsers
                        .map((row) => row.account_id)
                        .filter((id): id is number => typeof id === "number")
                );

                return serializeBigInt({
                    type,
                    count: total,
                    details: periods.map((p) => {
                        const account = p.Customer.Account;
                        const nextAt = p.next_activity_date;
                        const hoursOverdue = nextAt
                            ? Math.max(
                                  0,
                                  Math.round(
                                      (currentTime.getTime() -
                                          nextAt.getTime()) /
                                          (60 * 60 * 1000)
                                  )
                              )
                            : null;
                        const creditOnly =
                            account.has_collection === false &&
                            account.has_credit_insurance === true;
                        const importFrozen = importFrozenAccounts.has(
                            p.Customer.account_id
                        );
                        const noActiveUser = !accountsWithActiveUser.has(
                            p.Customer.account_id
                        );
                        const hasScheduledAutomated =
                            (p.Activity?.length ?? 0) > 0;
                        let likely_cause = "workflow_backlog_or_error";
                        if (p.Customer.automation_stuck_no_contacts) {
                            likely_cause = "stuck_no_contacts";
                        } else if (creditOnly) {
                            likely_cause = "credit_only_account_skipped";
                        } else if (importFrozen) {
                            likely_cause = "account_frozen_import";
                        } else if (noActiveUser) {
                            likely_cause = "no_active_system_user";
                        } else if (hasScheduledAutomated) {
                            likely_cause =
                                "scheduled_exists_flag_not_cleared";
                        }

                        return {
                            account_name: account.name || "N/A",
                            customer_number:
                                p.Customer.customer_number ||
                                String(p.Customer.id),
                            customer_id: p.customer_id,
                            collection_period: p.id,
                            category: p.current_category,
                            last_step: p.last_automated_step,
                            next_activity_date: nextAt,
                            hours_overdue: hoursOverdue,
                            stuck_no_contacts: p.Customer
                                .automation_stuck_no_contacts
                                ? "yes"
                                : "no",
                            credit_only: creditOnly ? "yes" : "no",
                            import_frozen: importFrozen ? "yes" : "no",
                            no_active_user: noActiveUser ? "yes" : "no",
                            has_scheduled_automated: hasScheduledAutomated
                                ? "yes"
                                : "no",
                            likely_cause,
                        };
                    }),
                    runbook: [
                        "1. Confirm Activity Workflow Manager cron is running and check recent errors for these period IDs.",
                        "2. If import_frozen=yes, wait for ImportJob Processing to finish, then re-check.",
                        "3. If no_active_user=yes, activate a user on the account (workflow needs a system actor).",
                        "4. If credit_only=yes, automation is intentionally skipped for that account.",
                        "5. If stuck_no_contacts=yes, add valid contacts (or clear automation_stuck_no_contacts after fix).",
                        "6. Grafana drilldown: Alert Data Drilldown → Overdue Activity Creation panel.",
                    ].join(" "),
                });
            }
            case "high_email_bounces": {
                const where = {
                    type: "Email" as const,
                    status: "BOUNCED" as const,
                    created_at: { gte: twentyFourHoursAgo },
                };
                const [total, activities] = await Promise.all([
                    this.db.activity.count({ where }),
                    this.db.activity.findMany({
                        where,
                        take: limitNum,
                        orderBy: { created_at: "desc" },
                        select: {
                            id: true,
                            status: true,
                            created_at: true,
                            customer_id: true,
                            collection_period_id: true,
                            Customer: {
                                select: {
                                    customer_number: true,
                                    email: true,
                                    Account: { select: { name: true } },
                                },
                            },
                        },
                    }),
                ]);
                return serializeBigInt({
                    type,
                    count: total,
                    details: activities.map((a) => ({
                        account_name: a.Customer?.Account?.name || "N/A",
                        customer_number:
                            a.Customer?.customer_number ||
                            String(a.customer_id),
                        customer_id: a.customer_id,
                        customer_email: a.Customer?.email || "N/A",
                        activity_id_display: String(a.id),
                        collection_period: a.collection_period_id,
                        status: a.status,
                        created_at: a.created_at,
                    })),
                    runbook: [
                        "1. Inspect bounced addresses for typos / invalid domains on these customers.",
                        "2. Check SMTP/SES reputation and bounce configuration.",
                        "3. Grafana drilldown: Email Bounces panel.",
                    ].join(" "),
                });
            }
            case "high_sms_failures": {
                const where = {
                    type: "SMS" as const,
                    status: "FAILED" as const,
                    created_at: { gte: twentyFourHoursAgo },
                };
                const [total, activities] = await Promise.all([
                    this.db.activity.count({ where }),
                    this.db.activity.findMany({
                        where,
                        take: limitNum,
                        orderBy: { created_at: "desc" },
                        select: {
                            id: true,
                            status: true,
                            created_at: true,
                            customer_id: true,
                            collection_period_id: true,
                            Customer: {
                                select: {
                                    customer_number: true,
                                    Account: { select: { name: true } },
                                    Person: { select: { mobile: true } },
                                },
                            },
                        },
                    }),
                ]);
                return serializeBigInt({
                    type,
                    count: total,
                    details: activities.map((a) => ({
                        account_name: a.Customer?.Account?.name || "N/A",
                        customer_number:
                            a.Customer?.customer_number ||
                            String(a.customer_id),
                        customer_id: a.customer_id,
                        mobile: a.Customer?.Person?.mobile || "N/A",
                        activity_id_display: String(a.id),
                        collection_period: a.collection_period_id,
                        status: a.status,
                        created_at: a.created_at,
                    })),
                    runbook: [
                        "1. Check SMS vendor credentials/balance and recent vendor error logs.",
                        "2. Validate mobile numbers on affected customers.",
                        "3. Grafana drilldown: SMS Failures panel.",
                    ].join(" "),
                });
            }
            case "no_system_activities_24h": {
                const [lastSystemActivity, workflowCron, processCron] =
                    await Promise.all([
                        this.db.activity.findFirst({
                            where: { system_generated: true },
                            orderBy: { created_at: "desc" },
                            select: {
                                id: true,
                                created_at: true,
                                type: true,
                                customer_id: true,
                                Customer: {
                                    select: {
                                        customer_number: true,
                                        Account: { select: { name: true } },
                                    },
                                },
                            },
                        }),
                        this.db.cronJob.findFirst({
                            where: {
                                name: {
                                    contains: "Activity Workflow",
                                    mode: "insensitive",
                                },
                            },
                            select: {
                                name: true,
                                active: true,
                                last_run_at: true,
                                next_run_at: true,
                                failure_count_30d: true,
                            },
                        }),
                        this.db.cronJob.findFirst({
                            where: {
                                name: {
                                    contains: "Automated Collection",
                                    mode: "insensitive",
                                },
                            },
                            select: {
                                name: true,
                                active: true,
                                last_run_at: true,
                                next_run_at: true,
                                failure_count_30d: true,
                            },
                        }),
                    ]);

                const hoursSinceLast = lastSystemActivity?.created_at
                    ? Math.round(
                          ((currentTime.getTime() -
                              lastSystemActivity.created_at.getTime()) /
                              (1000 * 60 * 60)) *
                              10
                      ) / 10
                    : 999;

                const details = [
                    {
                        metric: "hours_since_last_system_activity",
                        value: hoursSinceLast,
                        last_activity_id: lastSystemActivity
                            ? String(lastSystemActivity.id)
                            : "none",
                        last_activity_at:
                            lastSystemActivity?.created_at ?? null,
                        last_activity_type: lastSystemActivity?.type ?? "N/A",
                        last_account:
                            lastSystemActivity?.Customer?.Account?.name ??
                            "N/A",
                        last_customer:
                            lastSystemActivity?.Customer?.customer_number ??
                            "N/A",
                    },
                    {
                        metric: "cron_activity_workflow",
                        value: workflowCron?.name ?? "not_found",
                        active: workflowCron?.active ? "yes" : "no",
                        last_run_at: workflowCron?.last_run_at ?? null,
                        next_run_at: workflowCron?.next_run_at ?? null,
                        failures_30d: workflowCron?.failure_count_30d ?? null,
                    },
                    {
                        metric: "cron_process_automated_periods",
                        value: processCron?.name ?? "not_found",
                        active: processCron?.active ? "yes" : "no",
                        last_run_at: processCron?.last_run_at ?? null,
                        next_run_at: processCron?.next_run_at ?? null,
                        failures_30d: processCron?.failure_count_30d ?? null,
                    },
                ];

                return serializeBigInt({
                    type,
                    count: hoursSinceLast > 24 ? 1 : 0,
                    details,
                    runbook: [
                        "1. Confirm Activity Workflow Manager and Process Automated Collection Periods are active and running.",
                        "2. Check for frozen accounts / credit-only filters blocking all automation.",
                        "3. Inspect cron failure counts and application logs for workflow errors.",
                    ].join(" "),
                });
            }
            case "stuck_import_jobs": {
                const where = {
                    status: { in: ["Pending" as const, "Processing" as const] },
                    created_at: { lt: oneHourAgo },
                };
                const [total, jobs] = await Promise.all([
                    this.db.importJob.count({ where }),
                    this.db.importJob.findMany({
                        where,
                        take: limitNum,
                        orderBy: { created_at: "asc" },
                        select: {
                            id: true,
                            status: true,
                            import_type: true,
                            created_at: true,
                            started_at: true,
                            processed_records: true,
                            total_records: true,
                            error_message: true,
                            metadata: true,
                            Account: { select: { name: true, id: true } },
                        },
                    }),
                ]);
                return serializeBigInt({
                    type,
                    count: total,
                    details: jobs.map((j) => {
                        const meta =
                            j.metadata &&
                            typeof j.metadata === "object" &&
                            !Array.isArray(j.metadata)
                                ? (j.metadata as Record<string, unknown>)
                                : {};
                        return {
                            account_name: j.Account?.name || "N/A",
                            account_id: j.Account?.id,
                            import_job_id: j.id,
                            status: j.status,
                            import_type: j.import_type,
                            source: String(meta.source ?? "file"),
                            created_at: j.created_at,
                            started_at: j.started_at,
                            progress: `${j.processed_records}/${j.total_records}`,
                            error_message: j.error_message || "N/A",
                        };
                    }),
                    runbook: [
                        "1. Check ImportJob worker/cron and whether the account is frozen by a stuck Processing job.",
                        "2. For billing_connector source, inspect Sync Billing Connectors / Mongo sync history.",
                        "3. Fail or resume the stuck job if it is abandoned.",
                    ].join(" "),
                });
            }
            case "stale_disputes": {
                const where = {
                    dispute_status: {
                        in: [
                            "New" as const,
                            "Under_Review" as const,
                            "Awaiting_Update" as const,
                        ],
                    },
                    created_at: { lt: sevenDaysAgo },
                };
                const [total, disputes] = await Promise.all([
                    this.db.customerDispute.count({ where }),
                    this.db.customerDispute.findMany({
                        where,
                        take: limitNum,
                        orderBy: { created_at: "asc" },
                        select: {
                            id: true,
                            dispute_status: true,
                            created_at: true,
                            customer_id: true,
                            Customer: {
                                select: {
                                    customer_number: true,
                                    Account: { select: { name: true } },
                                },
                            },
                        },
                    }),
                ]);
                return serializeBigInt({
                    type,
                    count: total,
                    details: disputes.map((d) => {
                        const ageDays = Math.round(
                            (currentTime.getTime() - d.created_at.getTime()) /
                                (24 * 60 * 60 * 1000)
                        );
                        return {
                            account_name: d.Customer?.Account?.name || "N/A",
                            customer_number:
                                d.Customer?.customer_number ||
                                String(d.customer_id),
                            customer_id: d.customer_id,
                            dispute_id: d.id,
                            status: d.dispute_status,
                            created_at: d.created_at,
                            age_days: ageDays,
                        };
                    }),
                    runbook: [
                        "1. Review open disputes older than 7 days and update status or resolve.",
                        "2. Check assignee workload for Under_Review / Awaiting_Update disputes.",
                    ].join(" "),
                });
            }
            default:
                return {
                    type: type || "unknown",
                    count: 0,
                    details: [],
                    message: "Unsupported or missing alert type",
                };
        }
    }
}
