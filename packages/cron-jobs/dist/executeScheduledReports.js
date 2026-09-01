"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeScheduledReports = executeScheduledReports;
const accountSender_1 = require("./email/accountSender");
const sendSmtpHtmlEmail_1 = require("./email/sendSmtpHtmlEmail");
const cronFrozenAccountGuard_1 = require("./accountFreeze/cronFrozenAccountGuard");
function computeNextRunAt(from, scheduleType, config) {
    const next = new Date(from);
    const type = scheduleType.toLowerCase();
    if (type === "hourly") {
        next.setUTCHours(next.getUTCHours() + 1);
        return next;
    }
    if (type === "daily") {
        next.setUTCDate(next.getUTCDate() + 1);
        return next;
    }
    if (type === "weekly") {
        next.setUTCDate(next.getUTCDate() + 7);
        return next;
    }
    if (type === "monthly") {
        next.setUTCMonth(next.getUTCMonth() + 1);
        return next;
    }
    if (config?.intervalHours && Number.isFinite(config.intervalHours)) {
        next.setUTCHours(next.getUTCHours() + Number(config.intervalHours));
        return next;
    }
    if (config?.intervalDays && Number.isFinite(config.intervalDays)) {
        next.setUTCDate(next.getUTCDate() + Number(config.intervalDays));
        return next;
    }
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
}
function parseScheduleConfig(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    return raw;
}
/**
 * Due report schedules: execute via reports Nest S2S when REPORTS_SERVICE_URL
 * is set; email CSV/Excel attachment to schedule_config.recipients when configured.
 */
async function executeScheduledReports(prisma, freeze) {
    const start = Date.now();
    const now = new Date();
    const dueRaw = await prisma.reportSchedule.findMany({
        where: {
            is_active: true,
            OR: [{ next_run_at: null }, { next_run_at: { lte: now } }],
        },
        select: {
            id: true,
            report_id: true,
            schedule_type: true,
            schedule_config: true,
            next_run_at: true,
            Report: {
                select: { account_id: true, name: true },
            },
        },
        take: 50,
    });
    const { kept: due, skippedAccountIds } = freeze
        ? (0, cronFrozenAccountGuard_1.partitionByFrozenAccount)(dueRaw.map((schedule) => ({
            ...schedule,
            account_id: schedule.Report?.account_id ?? null,
        })), freeze.frozenAccountIds)
        : {
            kept: dueRaw.map((schedule) => ({
                ...schedule,
                account_id: schedule.Report?.account_id ?? null,
            })),
            skippedAccountIds: [],
        };
    if (freeze && skippedAccountIds.length > 0) {
        freeze.reportSkips(skippedAccountIds);
    }
    const reportsBase = process.env.REPORTS_SERVICE_URL?.replace(/\/$/, "");
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    const mode = reportsBase && internalSecret ? "s2s" : "timestamp_only";
    let executed = 0;
    let failed = 0;
    let emailed = 0;
    for (const schedule of due) {
        try {
            const config = parseScheduleConfig(schedule.schedule_config);
            const recipients = Array.isArray(config?.recipients)
                ? config.recipients.filter((r) => typeof r === "string" && r.trim().length > 0)
                : [];
            const format = config?.format || "csv";
            let exportPayload = null;
            if (mode === "s2s") {
                const executeRes = await fetch(`${reportsBase}/internal/reports/${schedule.report_id}/execute`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-internal-service-secret": internalSecret,
                    },
                    body: JSON.stringify({
                        triggeredBy: "report-scheduler-cron",
                        scheduleId: schedule.id,
                    }),
                });
                if (!executeRes.ok) {
                    const accountId = schedule.Report?.account_id;
                    const accountSuffix = accountId != null ? ` (account ${accountId})` : "";
                    throw new Error(`Reports execute HTTP ${executeRes.status} for report ${schedule.report_id}${accountSuffix}`);
                }
                if (recipients.length > 0) {
                    const executeJson = (await executeRes.json());
                    const exportRes = await fetch(`${reportsBase}/internal/reports/${schedule.report_id}/export`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-internal-service-secret": internalSecret,
                        },
                        body: JSON.stringify({
                            format,
                            executeResult: executeJson,
                        }),
                    });
                    if (!exportRes.ok) {
                        throw new Error(`Reports export HTTP ${exportRes.status} for report ${schedule.report_id}`);
                    }
                    exportPayload = (await exportRes.json());
                }
            }
            if (recipients.length > 0 &&
                exportPayload &&
                schedule.Report?.account_id) {
                const sender = await (0, accountSender_1.resolveAccountEmailSender)(prisma, schedule.Report.account_id);
                const attachmentBuffer = Buffer.from(exportPayload.contentBase64, "base64");
                const reportName = schedule.Report.name || "Report";
                for (const recipient of recipients) {
                    const result = await (0, sendSmtpHtmlEmail_1.sendSmtpHtmlEmail)({
                        toEmail: recipient,
                        subject: `Scheduled report: ${reportName}`,
                        html: `<p>Your scheduled report <strong>${reportName}</strong> is attached.</p>`,
                        fromName: sender.fromName,
                        replyToEmail: sender.replyToEmail || undefined,
                        attachments: [
                            {
                                filename: exportPayload.filename,
                                content: attachmentBuffer,
                                contentType: exportPayload.contentType,
                            },
                        ],
                    });
                    if (!result.skipped) {
                        emailed += 1;
                    }
                }
            }
            await prisma.reportSchedule.update({
                where: { id: schedule.id },
                data: {
                    last_run_at: now,
                    next_run_at: computeNextRunAt(now, schedule.schedule_type, config),
                },
            });
            executed += 1;
        }
        catch {
            failed += 1;
        }
    }
    return {
        success: failed === 0,
        message: `Report scheduler: ${executed}/${due.length} executed (${mode}, ${emailed} emails)`,
        summary: { due: due.length, executed, failed, emailed, mode },
        durationMs: Date.now() - start,
    };
}
