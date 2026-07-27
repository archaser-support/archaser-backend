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
}
