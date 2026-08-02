import {
    Body,
    Controller,
    Get,
    NotFoundException,
    Post,
    Query,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { DatabaseService } from "../database/database.service";

@ApiTags("communication-intelligence")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/communication-intelligence")
export class CommunicationIntelligenceController {
    constructor(private readonly db: DatabaseService) {}

    @Post("channel-selection")
    @ApiOperation({
        summary: "Intelligent channel selection (Nest-native pragmatic)",
    })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async channelSelection(@Body() body: Record<string, unknown>) {
        const activityId = body.activityId;
        const customerId = body.customerId;
        if (!activityId || !customerId) {
            return {
                error: "activityId and customerId are required",
            };
        }
        const activity = await this.db.activity.findUnique({
            where: { id: BigInt(Number(activityId)) },
            include: {
                Account: {
                    select: {
                        id: true,
                        intelligent_channel_selection_enabled: true,
                    },
                },
                ActivityContact: {
                    include: { Contact: true },
                    take: 10,
                },
            },
        });
        if (!activity) {
            throw new NotFoundException({ error: "Activity not found" });
        }
        if (!activity.Account?.intelligent_channel_selection_enabled) {
            return {
                error: "Intelligent channel selection is not enabled for this customer",
                enabled: false,
            };
        }
        const contacts = activity.ActivityContact || [];
        const preferred =
            contacts.find((c) => c.Contact?.email)?.communication_channel ||
            contacts.find((c) => c.Contact?.mobile)?.communication_channel ||
            activity.type ||
            "Email";
        return {
            enabled: true,
            selectedChannel: preferred,
            reason: "nest_pragmatic_default",
            alternatives: ["Email", "SMS", "WhatsApp"].filter(
                (c) => c !== preferred
            ),
            activityId: Number(activityId),
            customerId: Number(customerId),
        };
    }

    @Get("learning-data")
    @ApiOperation({ summary: "Communication intelligence learning data" })
    async learningData(
        @Query("accountId") accountIdRaw?: string,
        @Query("limit") limitRaw?: string
    ) {
        const accountId = accountIdRaw ? parseInt(accountIdRaw, 10) : null;
        const limit = Math.min(parseInt(limitRaw || "50", 10) || 50, 200);
        const where: Record<string, unknown> = {
            channel_selection_reason: { not: null },
        };
        if (accountId && Number.isFinite(accountId)) {
            where.Activity = { account_id: accountId };
        }
        const rows = await this.db.activityContact.findMany({
            where,
            take: limit,
            orderBy: { modified_at: "desc" },
            select: {
                id: true,
                communication_channel: true,
                channel_selection_reason: true,
                predicted_success_rate: true,
                status: true,
                delivered_at: true,
                failed_at: true,
            },
        });
        return {
            samples: rows.map((r) => ({
                ...r,
                predicted_success_rate:
                    r.predicted_success_rate != null
                        ? Number(r.predicted_success_rate)
                        : null,
            })),
            total: rows.length,
        };
    }

    @Get("analytics")
    @ApiOperation({ summary: "Channel selection analytics aggregates" })
    async analytics(
        @Query("customerId") customerIdRaw?: string,
        @Query("channel") channel?: string,
        @Query("startDate") startDateRaw?: string,
        @Query("endDate") endDateRaw?: string,
        @Query("query") query?: string
    ) {
        const where: Record<string, unknown> = {
            channel_selection_reason: { not: null },
        };
        const activityWhere: Record<string, unknown> = {};
        if (customerIdRaw) {
            const customerId = parseInt(customerIdRaw, 10);
            if (Number.isFinite(customerId)) {
                activityWhere.customer_id = customerId;
            }
        }
        if (startDateRaw || endDateRaw) {
            activityWhere.created_at = {
                ...(startDateRaw ? { gte: new Date(startDateRaw) } : {}),
                ...(endDateRaw ? { lte: new Date(endDateRaw) } : {}),
            };
        }
        if (Object.keys(activityWhere).length) {
            where.Activity = activityWhere;
        }
        if (channel && channel !== "all") {
            where.communication_channel = channel;
        }
        if (query?.trim()) {
            where.channel_selection_reason = {
                contains: query.trim(),
                mode: "insensitive",
            };
        }

        const rows = await this.db.activityContact.findMany({
            where,
            select: {
                communication_channel: true,
                status: true,
                delivered_at: true,
                failed_at: true,
                created_at: true,
            },
            take: 5000,
        });

        const byChannel = new Map<
            string,
            { totalAttempts: number; totalSuccesses: number; durations: number[] }
        >();
        for (const row of rows) {
            const ch = String(row.communication_channel || "Unknown");
            const entry = byChannel.get(ch) || {
                totalAttempts: 0,
                totalSuccesses: 0,
                durations: [] as number[],
            };
            entry.totalAttempts += 1;
            const success =
                row.status === "Delivered" ||
                row.status === "Sent" ||
                !!row.delivered_at;
            if (success) entry.totalSuccesses += 1;
            if (row.delivered_at && row.created_at) {
                entry.durations.push(
                    row.delivered_at.getTime() - row.created_at.getTime()
                );
            }
            byChannel.set(ch, entry);
        }

        const channelMetrics = [...byChannel.entries()].map(([ch, m]) => ({
            channel: ch,
            totalAttempts: m.totalAttempts,
            totalSuccesses: m.totalSuccesses,
            successRate:
                m.totalAttempts > 0
                    ? m.totalSuccesses / m.totalAttempts
                    : 0,
            averageResponseTime:
                m.durations.length > 0
                    ? m.durations.reduce((a, b) => a + b, 0) / m.durations.length
                    : null,
        }));

        return {
            channelMetrics,
            totalRecords: rows.length,
            period: {
                startDate: startDateRaw || null,
                endDate: endDateRaw || null,
            },
            generatedAt: new Date().toISOString(),
        };
    }
}
