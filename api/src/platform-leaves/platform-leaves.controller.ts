import {
    Body,
    Controller,
    Get,
    Headers,
    Post,
    Query,
    UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

@ApiTags("platform-leaves")
@Controller("api")
export class PlatformLeavesController {
    constructor(private readonly db: DatabaseService) {}

    @Get("alert-details")
    @ApiOperation({
        summary: "Alert enrichment details for SNS Lambda (API key)",
    })
    async alertDetails(
        @Headers("x-api-key") apiKey: string | undefined,
        @Query("type") type: string,
        @Query("limit") limitRaw?: string
    ) {
        if (apiKey !== process.env.ALERT_DETAILS_API_KEY) {
            throw new UnauthorizedException({ error: "Unauthorized" });
        }
        const limitNum = Math.min(parseInt(limitRaw || "10", 10) || 10, 50);
        const currentTime = new Date();
        const twentyFourHoursAgo = new Date(
            currentTime.getTime() - 24 * 60 * 60 * 1000
        );

        switch (type) {
            case "automation_stuck_no_contacts": {
                const stuckCustomers = await this.db.customer.findMany({
                    where: { automation_stuck_no_contacts: true },
                    select: {
                        id: true,
                        customer_number: true,
                        email: true,
                        CustomerCollectionPeriod: {
                            where: { period_end_date: null },
                            take: 1,
                            orderBy: { created_at: "desc" },
                            select: {
                                id: true,
                                current_category: true,
                                total_outstanding_amount: true,
                                period_start_date: true,
                            },
                        },
                    },
                    take: limitNum,
                    orderBy: { id: "desc" },
                });
                return serializeBigInt({
                    type,
                    count: stuckCustomers.length,
                    details: stuckCustomers.map((c) => {
                        const p = c.CustomerCollectionPeriod?.[0];
                        return {
                            period_id: p?.id,
                            customer_id: c.customer_number || String(c.id),
                            customer_email: c.email || "N/A",
                            category: p?.current_category,
                            outstanding_amount: p?.total_outstanding_amount,
                            period_start: p?.period_start_date,
                        };
                    }),
                });
            }
            case "cron_jobs_overdue":
            case "cron_jobs_not_run_24h": {
                const jobs = await this.db.cronJob.findMany({
                    where: {
                        active: true,
                        OR: [
                            { next_run_at: { lt: currentTime } },
                            {
                                last_run_at: {
                                    lt: twentyFourHoursAgo,
                                },
                            },
                            { last_run_at: null },
                        ],
                    },
                    take: limitNum,
                    orderBy: { next_run_at: "asc" },
                });
                return serializeBigInt({
                    type,
                    count: jobs.length,
                    details: jobs.map((j) => ({
                        id: j.id,
                        name: j.name,
                        last_run_at: j.last_run_at,
                        next_run_at: j.next_run_at,
                    })),
                });
            }
            case "stuck_activities": {
                const activities = await this.db.activity.findMany({
                    where: {
                        status: { in: ["SCHEDULED", "PAUSED"] },
                        schedule_time: { lt: twentyFourHoursAgo },
                    },
                    take: limitNum,
                    orderBy: { schedule_time: "asc" },
                    select: {
                        id: true,
                        type: true,
                        status: true,
                        schedule_time: true,
                        customer_id: true,
                    },
                });
                return serializeBigInt({
                    type,
                    count: activities.length,
                    details: activities,
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

    @Post("contact-response")
    @ApiOperation({
        summary: "Public contact response / stop escalation (Nest-native)",
    })
    async contactResponse(@Body() body: Record<string, unknown>) {
        const activityId = Number(body.activityId);
        const contactId = Number(body.contactId);
        const channel = body.channel;
        if (!activityId || !contactId || !channel) {
            return {
                error: "Missing required fields: activityId, contactId, channel",
            };
        }
        const row = await this.db.activityContact.findFirst({
            where: {
                activity_id: BigInt(activityId),
                contact_id: contactId,
            },
        });
        if (row) {
            await this.db.activityContact.update({
                where: { id: row.id },
                data: {
                    response_received_at: new Date(),
                    response_channel: channel as never,
                    modified_at: new Date(),
                },
            });
        }
        return {
            success: true,
            message: "Contact response handled successfully",
            data: {
                activityId,
                contactId,
                channel,
                timestamp: new Date().toISOString(),
            },
        };
    }
}
