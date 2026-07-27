import {
    BadRequestException,
    Body,
    Controller,
    ForbiddenException,
    Get,
    Post,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { randomUUID } from "crypto";
import { AccessScopeService } from "../auth/access-scope.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

type DismissBody = {
    customerCollectionPeriodId: number;
    followUpTime: string;
    customerId: number;
    customerName?: string;
    action?: "dismiss" | "snooze" | "complete";
    snoozedUntil?: string;
};

@ApiTags("agents")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/agents/follow-up-reminder")
export class AgentsFollowUpController {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    private async assertReminderPermission(user: JwtPayload) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const allowed = await this.accessScope.hasPermission(
            accountId,
            role,
            "view_follow_up_reminders"
        );
        if (!allowed) {
            throw new ForbiddenException({
                error: "Forbidden: view_follow_up_reminders permission required",
            });
        }
        return userInfo;
    }

    @Get("dismissed")
    @ApiOperation({ summary: "Dismissed / snoozed follow-up reminders" })
    @ApiUnauthorizedResponse({
        description: "Missing Bearer or session cookie",
    })
    async dismissed(@CurrentUser() user: JwtPayload) {
        const userInfo = await this.assertReminderPermission(user);
        const now = new Date();
        const notifications = await this.db.notification.findMany({
            where: {
                user_id: userInfo.userId,
                metadata: {
                    path: ["followUpReminder"],
                    equals: true,
                },
            },
        });

        const dismissed: Array<{
            customerCollectionPeriodId: number;
            followUpTime: string;
            snoozedUntil?: string;
        }> = [];

        for (const n of notifications) {
            const m = n.metadata as Record<string, unknown> | null;
            if (!m || m.customerCollectionPeriodId == null || !m.followUpTime) {
                continue;
            }
            const snoozedUntil =
                typeof m.snoozedUntil === "string"
                    ? new Date(m.snoozedUntil)
                    : null;
            const isSnoozed = !!(snoozedUntil && snoozedUntil > now);
            if (n.read === true || isSnoozed) {
                dismissed.push({
                    customerCollectionPeriodId:
                        m.customerCollectionPeriodId as number,
                    followUpTime: m.followUpTime as string,
                    snoozedUntil:
                        typeof m.snoozedUntil === "string"
                            ? m.snoozedUntil
                            : undefined,
                });
            }
        }

        return { dismissed };
    }

    @Post("dismiss")
    @ApiOperation({ summary: "Dismiss, snooze, or complete a follow-up" })
    async dismiss(
        @CurrentUser() user: JwtPayload,
        @Body() body: DismissBody
    ) {
        const userInfo = await this.assertReminderPermission(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const userId = userInfo.userId;

        if (
            body.customerCollectionPeriodId == null ||
            !body.followUpTime ||
            body.customerId == null
        ) {
            throw new BadRequestException({
                error: "Missing required fields: customerCollectionPeriodId, followUpTime, customerId",
            });
        }

        const action = body.action ?? "dismiss";
        if (action === "snooze" && !body.snoozedUntil) {
            throw new BadRequestException({
                error: "snoozedUntil is required when action is snooze",
            });
        }

        const metadata = {
            followUpReminder: true,
            customerCollectionPeriodId: body.customerCollectionPeriodId,
            followUpTime: body.followUpTime,
            customerId: body.customerId,
            customerName: body.customerName ?? "",
            dismissedAt:
                action === "dismiss" ? new Date().toISOString() : undefined,
            snoozedUntil: action === "snooze" ? body.snoozedUntil : undefined,
            completedById: action === "complete" ? userId : undefined,
        };

        const title =
            action === "snooze"
                ? "Follow-up reminder snoozed"
                : action === "complete"
                  ? "Follow-up marked complete"
                  : "Follow-up reminder dismissed";
        const message =
            action === "snooze"
                ? `Snoozed until ${body.snoozedUntil}`
                : action === "complete"
                  ? `Marked follow-up complete for ${body.customerName ?? "customer"}`
                  : `Dismissed follow-up for ${body.customerName ?? "customer"}`;
        const actionUrl = `/app/customers/${body.customerId}?activeTab=outstanding-activities-tab`;

        if (action === "complete") {
            await this.db.customerCollectionPeriod.updateMany({
                where: {
                    id: body.customerCollectionPeriodId,
                    Customer: { account_id: accountId },
                },
                data: {
                    follow_up_time: null,
                    modified_by: userId,
                },
            });
        }

        const existing = await this.db.notification.findMany({
            where: {
                account_id: accountId,
                user_id: userId,
                metadata: {
                    path: ["followUpReminder"],
                    equals: true,
                },
            },
        });
        const match = existing.find((n) => {
            const m = n.metadata as Record<string, unknown> | null;
            return (
                m?.customerCollectionPeriodId ===
                    body.customerCollectionPeriodId &&
                m?.followUpTime === body.followUpTime
            );
        });

        const read = action === "dismiss" || action === "complete";

        if (match) {
            await this.db.notification.update({
                where: { id: match.id },
                data: {
                    title,
                    message,
                    read,
                    action_url: actionUrl,
                    metadata: metadata as object,
                    modified_at: new Date(),
                },
            });
            return serializeBigInt({ success: true, updated: true });
        }

        await this.db.notification.create({
            data: {
                id: randomUUID(),
                type: "Primary",
                title,
                message,
                priority: "Normal",
                user_id: userId,
                account_id: accountId,
                read,
                action_url: actionUrl,
                metadata: metadata as object,
                created_at: new Date(),
                modified_at: new Date(),
            },
        });
        return serializeBigInt({ success: true, updated: false });
    }
}
