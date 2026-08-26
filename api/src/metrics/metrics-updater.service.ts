import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import nodemailer from "nodemailer";
import { DatabaseService } from "../database/database.service";
import { ensureMongoConnection, mongoose } from "../logging/mongoose.connection";
import { Log as LogModel } from "../logging/log.model";
import { LogLevel } from "../logging/mongo-log.types";
import type { ArchaserBusinessMetrics } from "./archaser-business-metrics";

const UPDATE_INTERVAL_MS = 60_000;

@Injectable()
export class MetricsUpdaterService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(MetricsUpdaterService.name);
    private lastUpdateTime = 0;
    private m!: ArchaserBusinessMetrics;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly db: DatabaseService) {}

    bindMetrics(metrics: ArchaserBusinessMetrics): void {
        this.m = metrics;
    }

    onModuleInit(): void {
        this.timer = setInterval(() => {
            void this.updateIfDue(true);
        }, UPDATE_INTERVAL_MS);
    }

    onModuleDestroy(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** Refresh gauges at most once per minute (also on /metrics scrape). */
    async updateIfDue(force = false): Promise<void> {
        if (!this.m) {
            return;
        }
        const now = Date.now();
        if (!force && now - this.lastUpdateTime < UPDATE_INTERVAL_MS) {
            return;
        }
        this.lastUpdateTime = now;
        await this.updateAll();
    }

    private async updateAll(): Promise<void> {
        const currentTime = new Date();
            const oneHourAgo = new Date(currentTime.getTime() - 1 * 60 * 60 * 1000);
            const twentyFourHoursAgo = new Date(
                currentTime.getTime() - 24 * 60 * 60 * 1000
            );
            const sevenDaysAgo = new Date(
                currentTime.getTime() - 7 * 24 * 60 * 60 * 1000
            );
            const twoHoursAgo = new Date(currentTime.getTime() - 2 * 60 * 60 * 1000);

            // ============================================================
            // System & Database Health Metrics (High Priority)
            // ============================================================
            try {
                await this.db.$queryRaw`SELECT 1`;
                this.m.dbPostgresConnected.set(1);

                // Fetch Postgres active connections
                const pgStats = await this.db.$queryRaw<any[]>`SELECT count(*) as count FROM pg_stat_activity`;
                const pgCount = Number(pgStats[0]?.count || 0);
                this.m.dbPostgresConnections.set(pgCount);
            } catch (error) {
                this.logger.error("Postgres health check failed:", error);
                this.m.dbPostgresConnected.set(0);
                this.m.dbPostgresConnections.set(0);
            }

            if (process.env.NODE_ENV !== "development") {
                try {
                    await ensureMongoConnection();
                    this.m.dbMongodbConnected.set(1);

                    // Fetch MongoDB active connections
                    if (mongoose.connection.db) {
                        const mongoStats = await mongoose.connection.db.command({
                            serverStatus: 1,
                        });
                        const mongoCount = mongoStats.connections?.current || 0;
                        this.m.dbMongodbConnections.set(mongoCount);
                    }
                } catch (error) {
                    this.logger.error("MongoDB health check failed:", error);
                    this.m.dbMongodbConnected.set(0);
                    this.m.dbMongodbConnections.set(0);
                }
            } else {
                this.m.dbMongodbConnected.set(0);
                this.m.dbMongodbConnections.set(0);
            }

            // ============================================================
            // Communication Provider Connection Metrics
            // ============================================================
            try {
                const host = process.env.EMAIL_SERVER_HOST || "";
                const portRaw = process.env.EMAIL_SERVER_PORT || "";
                const user = process.env.EMAIL_SERVER_USER || "";
                const pass = process.env.EMAIL_SERVER_PASSWORD || "";
                const from = process.env.EMAIL_FROM || "";
                const port = parseInt(portRaw || "0", 10);

                const smtpConfigured =
                    host.trim() !== "" &&
                    Number.isFinite(port) &&
                    port > 0 &&
                    user.trim() !== "" &&
                    pass.trim() !== "" &&
                    from.trim() !== "";

                let smtpConnected = 0;
                if (smtpConfigured) {
                    try {
                        const transporter = nodemailer.createTransport({
                            host,
                            port,
                            secure: port === 465,
                            auth: {
                                user,
                                pass,
                            },
                            connectionTimeout: 3000,
                            greetingTimeout: 3000,
                            socketTimeout: 5000,
                        });
                        await transporter.verify();
                        smtpConnected = 1;
                    } catch {
                        smtpConnected = 0;
                    }
                }
                this.m.emailSmtpConnected.set(smtpConnected);

                const sesConfigured =
                    host.toLowerCase().includes("amazonaws.com") ||
                    !!process.env.SES_CONFIGURATION_SET;
                this.m.emailSesConnected.set(sesConfigured && smtpConnected ? 1 : 0);

                const activeVendors = await this.db.sMSVendor.findMany({
                    where: { is_active: true },
                    select: {
                        id: true,
                        name: true,
                        provider: true,
                        api_key: true,
                        account_sid: true,
                        auth_token: true,
                    },
                    orderBy: [{ priority: "asc" }, { id: "asc" }],
                });

                this.m.smsProvidersConfiguredTotal.set(activeVendors.length);
                this.m.smsProviderStatus.reset();

                for (const vendor of activeVendors) {
                    const provider = String(vendor.provider || "")
                        .trim()
                        .toLowerCase();
                    let stateValue = 0;
                    if (provider === "twilio") {
                        stateValue =
                            vendor.account_sid && vendor.auth_token ? 2 : 1;
                    } else if (provider === "messagebird" || provider === "inforu") {
                        stateValue = vendor.api_key ? 2 : 1;
                    } else {
                        stateValue =
                            vendor.api_key || (vendor.account_sid && vendor.auth_token)
                                ? 2
                                : 1;
                    }

                    this.m.smsProviderStatus
                        .labels(
                            String(vendor.id),
                            vendor.name || `Vendor-${vendor.id}`,
                            vendor.provider || "unknown"
                        )
                        .set(stateValue);
                }
            } catch (error) {
                this.logger.error("Communication connection metrics update failed:", error);
                this.m.emailSmtpConnected.set(0);
                this.m.emailSesConnected.set(0);
                this.m.smsProvidersConfiguredTotal.set(0);
                this.m.smsProviderStatus.reset();
            }

            try {
                // ============================================================
                // Cron Job Metrics
                // ============================================================
                const allCronJobs = await this.db.cronJob.findMany({
                    select: {
                        id: true,
                        name: true,
                        active: true,
                        next_run_at: true,
                        last_run_at: true,
                        last_execution_duration_seconds: true,
                        success_count_30d: true,
                        failure_count_30d: true,
                        timeout_count_30d: true,
                    },
                });


                const totalJobs = allCronJobs.length;
                const runningJobs = allCronJobs.filter(
                    (job) => job.active === true
                ).length;
                // Add 5-minute tolerance buffer to avoid false positives from timing/race conditions
                // Jobs are only considered overdue if they haven't run 5+ minutes past their scheduled time
                const fiveMinutesAgo = new Date(currentTime.getTime() - 5 * 60 * 1000);
                const overdueJobs = allCronJobs.filter(
                    (job) => job.next_run_at && job.next_run_at < fiveMinutesAgo
                ).length;
                const notRunIn24h = allCronJobs.filter(
                    (job) => !job.last_run_at || job.last_run_at < twentyFourHoursAgo
                ).length;

                // Calculate success rate
                const totalExecutions =
                    allCronJobs.reduce(
                        (sum: number, job) => sum + (job.success_count_30d || 0),
                        0
                    ) +
                    allCronJobs.reduce(
                        (sum: number, job) => sum + (job.failure_count_30d || 0),
                        0
                    ) +
                    allCronJobs.reduce(
                        (sum: number, job) => sum + (job.timeout_count_30d || 0),
                        0
                    );
                const totalSuccesses = allCronJobs.reduce(
                    (sum: number, job) => sum + (job.success_count_30d || 0),
                    0
                );
                const successRate =
                    totalExecutions > 0 ? (totalSuccesses / totalExecutions) * 100 : 0;

                this.m.cronJobsTotal.set(totalJobs);
                this.m.cronJobsRunning.set(runningJobs);
                this.m.cronJobsOverdue.set(overdueJobs);
                this.m.cronJobsNotRun24h.set(notRunIn24h);
                this.m.cronJobSuccessRate.set(successRate);

                // Update per-job metrics
                allCronJobs.forEach((job) => {
                    if (job.name) {
                        if (job.last_execution_duration_seconds !== null) {
                            this.m.cronJobDuration
                                .labels(job.name)
                                .set(job.last_execution_duration_seconds);
                        }
                        this.m.cronJobSuccessCount30d
                            .labels(job.name)
                            .set(job.success_count_30d || 0);
                        this.m.cronJobFailureCount30d
                            .labels(job.name)
                            .set(job.failure_count_30d || 0);
                        this.m.cronJobTimeoutCount30d
                            .labels(job.name)
                            .set(job.timeout_count_30d || 0);
                        if (job.last_run_at) {
                            this.m.cronJobLastRun
                                .labels(job.name)
                                .set(Math.floor(job.last_run_at.getTime() / 1000));
                        }
                        if (job.next_run_at) {
                            this.m.cronJobNextRun
                                .labels(job.name)
                                .set(Math.floor(job.next_run_at.getTime() / 1000));
                        }
                    }
                });

                // ============================================================
                // Activity Metrics
                // ============================================================
                const [
                    emailsSent24h,
                    emailsFailed24h,
                    emailsBounced24h,
                    smsSent24h,
                    smsFailed24h,
                    stuckActivities,
                    systemActivitiesCreated,
                    lastSystemActivity,
                    emailContactsTotal,
                    emailContactsDelivered,
                    emailContactsOpened,
                    emailContactsClicked,
                    emailContactsBounced,
                    emailContactsFailed,
                ] = await Promise.all([
                    this.db.activity.count({
                        where: {
                            type: "Email",
                            actual_delivery_time: { gte: twentyFourHoursAgo },
                        },
                    }),
                    this.db.activity.count({
                        where: {
                            type: "Email",
                            status: "FAILED",
                            created_at: { gte: twentyFourHoursAgo },
                        },
                    }),
                    this.db.activity.count({
                        where: {
                            type: "Email",
                            status: "BOUNCED",
                            created_at: { gte: twentyFourHoursAgo },
                        },
                    }),
                    this.db.activity.count({
                        where: {
                            type: "SMS",
                            actual_delivery_time: { gte: twentyFourHoursAgo },
                        },
                    }),
                    this.db.activity.count({
                        where: {
                            type: "SMS",
                            status: "FAILED",
                            created_at: { gte: twentyFourHoursAgo },
                        },
                    }),
                    this.db.activity.count({
                        where: {
                            status: "SCHEDULED",
                            schedule_time: { lt: twoHoursAgo },
                            system_generated: true,
                        },
                    }),
                    // Count system-generated activities created in last 24 hours
                    this.db.activity.count({
                        where: {
                            system_generated: true,
                            created_at: { gte: twentyFourHoursAgo },
                        },
                    }),
                    // Get last system-generated activity creation time
                    this.db.activity.findFirst({
                        where: { system_generated: true },
                        orderBy: { created_at: "desc" },
                        select: { created_at: true },
                    }),
                    // New Email Contact Metrics - filter by Email channel only
                    this.db.activityContact.count({
                        where: {
                            communication_channel: 'Email',
                            created_at: { gte: twentyFourHoursAgo }
                        },
                    }),
                    this.db.activityContact.count({
                        where: {
                            communication_channel: 'Email',
                            delivered_at: { gte: twentyFourHoursAgo }
                        },
                    }),
                    this.db.activityContact.count({
                        where: {
                            communication_channel: 'Email',
                            email_opened_at: { gte: twentyFourHoursAgo }
                        },
                    }),
                    this.db.activityContact.count({
                        where: {
                            communication_channel: 'Email',
                            email_clicked_at: { gte: twentyFourHoursAgo }
                        },
                    }),
                    this.db.activityContact.count({
                        where: {
                            communication_channel: 'Email',
                            bounced_at: { gte: twentyFourHoursAgo }
                        },
                    }),
                    this.db.activityContact.count({
                        where: {
                            communication_channel: 'Email',
                            failed_at: { gte: twentyFourHoursAgo }
                        },
                    }),
                ]);

                this.m.emailsSent.set(emailsSent24h);
                this.m.emailsFailed.set(emailsFailed24h);
                this.m.emailsBounced.set(emailsBounced24h);
                this.m.smsSent.set(smsSent24h);
                this.m.smsFailed.set(smsFailed24h);
                this.m.activitiesStuck.set(stuckActivities);
                this.m.systemActivitiesCreated24h.set(systemActivitiesCreated);

                this.m.emailContactsTotal24h.set(emailContactsTotal);
                this.m.emailContactsDelivered24h.set(emailContactsDelivered);
                this.m.emailContactsOpened24h.set(emailContactsOpened);
                this.m.emailContactsClicked24h.set(emailContactsClicked);
                this.m.emailContactsBounced24h.set(emailContactsBounced);
                this.m.emailContactsFailed24h.set(emailContactsFailed);

                // Calculate hours since last system activity
                if (lastSystemActivity?.created_at) {
                    const hoursSinceLast =
                        (currentTime.getTime() - lastSystemActivity.created_at.getTime()) /
                        (1000 * 60 * 60);
                    this.m.hoursSinceLastSystemActivity.set(
                        Math.round(hoursSinceLast * 10) / 10
                    );
                } else {
                    // No system activities exist, set to a high value to trigger alerts
                    this.m.hoursSinceLastSystemActivity.set(999);
                }

                // ============================================================
                // Import Metrics
                // ============================================================
                const [importsPending, importsStuck, imports24h] = await Promise.all([
                    this.db.importJob.count({
                        where: { status: { in: ["Pending", "Processing"] } },
                    }),
                    this.db.importJob.count({
                        where: {
                            status: { in: ["Pending", "Processing"] },
                            created_at: { lt: oneHourAgo },
                        },
                    }),
                    this.db.importJob.count({
                        where: { created_at: { gte: twentyFourHoursAgo } },
                    }),
                ]);

                this.m.importJobsPending.set(importsPending);
                this.m.importJobsStuck.set(importsStuck);
                this.m.importJobsSuccess24h.set(imports24h);

                // ============================================================
                // Collection Period Health Metrics
                // ============================================================
                const [
                    activeCollPeriods,
                    stuckNoContacts,
                    withoutActivities,
                    overdueCreation,
                ] = await Promise.all([
                    this.db.customerCollectionPeriod.count({
                        where: { period_end_date: null },
                    }),
                    this.db.customer.count({
                        where: {
                            automation_stuck_no_contacts: true,
                        },
                    }),
                    this.db.customerCollectionPeriod.count({
                        where: {
                            period_end_date: null,
                            current_category: "Automated",
                            OR: [
                                { next_activity_date: null },
                                { next_activity_date: { lt: twentyFourHoursAgo } },
                            ],
                            // Match ActivityService.hasScheduledAutomatedActivities: workflow clears
                            // next_activity_date when an automated activity row exists in SCHEDULED.
                            NOT: {
                                Activity: {
                                    some: {
                                        status: "SCHEDULED",
                                        ActivitiesSequence: {
                                            is: { category: "Automated" },
                                        },
                                    },
                                },
                            },
                        },
                    }),
                    this.db.customerCollectionPeriod.count({
                        where: {
                            period_end_date: null,
                            create_next_activity: true,
                            next_activity_date: { lt: currentTime },
                        },
                    }),
                ]);

                this.m.activeCollectionPeriods.set(activeCollPeriods);
                this.m.automationStuckNoContacts.set(stuckNoContacts);
                this.m.periodsWithoutActivities.set(withoutActivities);
                this.m.overdueActivityCreation.set(overdueCreation);

                // ============================================================
                // Dispute Metrics
                // ============================================================
                // dispute_status enum: New, Under_Review, Awaiting_Update, Resolved, Cancelled
                const [
                    openDisputes,
                    pendingDisputes,
                    created24h,
                    resolved24h,
                    staleDisputes,
                ] = await Promise.all([
                    this.db.customerDispute.count({
                        where: { dispute_status: "New" },
                    }),
                    this.db.customerDispute.count({
                        where: { dispute_status: { in: ["New", "Under_Review", "Awaiting_Update"] } },
                    }),
                    this.db.customerDispute.count({
                        where: { created_at: { gte: twentyFourHoursAgo } },
                    }),
                    this.db.customerDispute.count({
                        where: { closed_at: { gte: twentyFourHoursAgo } },
                    }),
                    this.db.customerDispute.count({
                        where: {
                            dispute_status: { in: ["New", "Under_Review", "Awaiting_Update"] },
                            created_at: { lt: sevenDaysAgo },
                        },
                    }),
                ]);

                this.m.disputesOpen.set(openDisputes);
                this.m.disputesPending.set(pendingDisputes);
                this.m.disputesCreated24h.set(created24h);
                this.m.disputesResolved24h.set(resolved24h);
                this.m.disputesStale.set(staleDisputes);

                // ============================================================
                // Promise to Pay Metrics
                // ============================================================
                const todayStart = new Date(currentTime);
                todayStart.setHours(0, 0, 0, 0);
                const todayEnd = new Date(currentTime);
                todayEnd.setHours(23, 59, 59, 999);

                const [activePTPs, ptpToday, brokenPTPs] = await Promise.all([
                    this.db.customerCollectionPeriod.count({
                        where: {
                            period_end_date: null,
                            promise_to_pay_date: { gte: currentTime },
                        },
                    }),
                    this.db.customerCollectionPeriod.count({
                        where: {
                            period_end_date: null,
                            promise_to_pay_date: { gte: todayStart, lte: todayEnd },
                        },
                    }),
                    this.db.customerCollectionPeriod.count({
                        where: {
                            period_end_date: null,
                            promise_to_pay_date: { lt: currentTime },
                            total_outstanding_amount: { gt: 0 },
                        },
                    }),
                ]);

                this.m.ptpActive.set(activePTPs);
                this.m.ptpDueToday.set(ptpToday);
                this.m.ptpBroken.set(brokenPTPs);

                // ============================================================
                // Contact Health Metrics
                // ============================================================
                const [
                    highBounce,
                    highSMSFail,
                    lowCommScore,
                    recentBounces,
                    recentSMSFails,
                ] = await Promise.all([
                    this.db.contact.count({
                        where: { email_bounce_count: { gte: 3 } },
                    }),
                    this.db.contact.count({
                        where: { sms_delivery_failure_count: { gte: 3 } },
                    }),
                    this.db.contact.count({
                        where: { communication_score: { lt: 0.5 } },
                    }),
                    this.db.contact.count({
                        where: { last_email_bounce: { gte: twentyFourHoursAgo } },
                    }),
                    this.db.contact.count({
                        where: { last_sms_failure: { gte: twentyFourHoursAgo } },
                    }),
                ]);

                this.m.contactsHighBounce.set(highBounce);
                this.m.contactsHighSMSFailure.set(highSMSFail);
                this.m.contactsLowCommScore.set(lowCommScore);
                this.m.recentEmailBounces.set(recentBounces);
                this.m.recentSMSFailures.set(recentSMSFails);



                // ============================================================
                // Error Log Metrics (MongoDB)
                // ============================================================
                if (process.env.NODE_ENV !== "development") {
                    try {
                        await ensureMongoConnection();
                        const [errors1h, errors24h, warnings24h] = await Promise.all([
                            LogModel.countDocuments({
                                level: LogLevel.ERROR,
                                timestamp: { $gte: oneHourAgo },
                            }),
                            LogModel.countDocuments({
                                level: LogLevel.ERROR,
                                timestamp: { $gte: twentyFourHoursAgo },
                            }),
                            LogModel.countDocuments({
                                level: LogLevel.WARNING,
                                timestamp: { $gte: twentyFourHoursAgo },
                            }),
                        ]);

                        this.m.applicationErrors1h.set(errors1h);
                        this.m.applicationErrors24h.set(errors24h);
                        this.m.applicationWarnings24h.set(warnings24h);
                    } catch (mongoError) {
                        // Continue without MongoDB metrics if there's an error
                        this.logger.error("Failed to fetch error logs from MongoDB:", mongoError);
                    }
                }

                // ============================================================
                // Billing Connector Metrics
                // ============================================================
                try {
                    const connectorsInError = await this.db.billingConnector.groupBy({
                        by: ["provider"],
                        where: { status: "Error" },
                        _count: { id: true },
                    });
                    const errorByProvider = new Map(
                        connectorsInError.map((row) => [row.provider, row._count.id])
                    );
                    for (const provider of ["PRIORITY", "SAP_BUSINESS_ONE"] as const) {
                        this.m.billingConnectorConnectorsInError.set(
                            { provider },
                            errorByProvider.get(provider) ?? 0
                        );
                    }

                    const latestCheckpoint = await this.db.connectorSyncState.aggregate({
                        _max: { backfill_last_checkpoint_at: true },
                    });
                    const checkpointTs =
                        latestCheckpoint._max.backfill_last_checkpoint_at?.getTime() ??
                        0;
                    this.m.billingConnectorLastCheckpointTimestamp.set(
                        { provider: "PRIORITY" },
                        checkpointTs / 1000
                    );

                    if (process.env.NODE_ENV !== "development") {
                        await ensureMongoConnection();
                        const staleCutoff = new Date(Date.now() - 15 * 60 * 1000);
                        const staleRunning =
                            (await mongoose.connection.db
                                ?.collection("connectorsyncexecutions")
                                .countDocuments({
                                    status: "RUNNING",
                                    started_at: { $lt: staleCutoff },
                                })) ?? 0;
                        this.m.billingConnectorStaleRunningCount.set(staleRunning);
                    }
                } catch (billingMetricsError) {
                    this.logger.error(
                        "Failed to update billing connector metrics:",
                        billingMetricsError
                    );
                }
            } catch (error) {
                this.logger.error("Error updating Prometheus metrics:", error);
            }
    }
}
