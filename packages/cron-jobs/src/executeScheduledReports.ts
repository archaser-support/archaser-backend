import type { PrismaClient } from "@prisma/client";

type ScheduleConfig = {
    cron?: string;
    intervalHours?: number;
    intervalDays?: number;
};

function computeNextRunAt(
    from: Date,
    scheduleType: string,
    config: ScheduleConfig | null
): Date {
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
    // Default: push 24h so a broken config does not hot-loop
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
}

/**
 * Due report schedules: execute via reports Nest S2S when REPORTS_SERVICE_URL
 * is set; otherwise mark run timestamps only (email delivery remains deferred).
 */
export async function executeScheduledReports(
    prisma: PrismaClient
): Promise<{
    success: boolean;
    message: string;
    summary: {
        due: number;
        executed: number;
        failed: number;
        mode: "s2s" | "timestamp_only";
    };
    durationMs: number;
}> {
    const start = Date.now();
    const now = new Date();
    const due = await prisma.reportSchedule.findMany({
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
        },
        take: 50,
    });

    const reportsBase = process.env.REPORTS_SERVICE_URL?.replace(/\/$/, "");
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    const mode: "s2s" | "timestamp_only" =
        reportsBase && internalSecret ? "s2s" : "timestamp_only";

    let executed = 0;
    let failed = 0;

    for (const schedule of due) {
        try {
            if (mode === "s2s") {
                const res = await fetch(
                    `${reportsBase}/internal/reports/${schedule.report_id}/execute`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-internal-service-secret": internalSecret!,
                        },
                        body: JSON.stringify({
                            triggeredBy: "report-scheduler-cron",
                            scheduleId: schedule.id,
                        }),
                    }
                );
                if (!res.ok) {
                    throw new Error(
                        `Reports execute HTTP ${res.status} for report ${schedule.report_id}`
                    );
                }
            }

            const config =
                schedule.schedule_config &&
                typeof schedule.schedule_config === "object"
                    ? (schedule.schedule_config as ScheduleConfig)
                    : null;
            await prisma.reportSchedule.update({
                where: { id: schedule.id },
                data: {
                    last_run_at: now,
                    next_run_at: computeNextRunAt(
                        now,
                        schedule.schedule_type,
                        config
                    ),
                },
            });
            executed += 1;
        } catch {
            failed += 1;
        }
    }

    return {
        success: failed === 0,
        message: `Report scheduler: ${executed}/${due.length} executed (${mode})`,
        summary: { due: due.length, executed, failed, mode },
        durationMs: Date.now() - start,
    };
}
