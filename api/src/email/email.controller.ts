import {
    Body,
    Controller,
    Get,
    Header,
    Post,
    Query,
    Redirect,
    Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { DatabaseService } from "../database/database.service";

const TRANSPARENT_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
);

/** Public email tracking + SES webhook (no DualAuth). */
@ApiTags("email")
@Controller("api/email")
export class EmailController {
    constructor(private readonly db: DatabaseService) {}

    @Get("track-open")
    @ApiOperation({ summary: "Email open tracking pixel (public)" })
    @Header("Cache-Control", "no-cache, no-store, must-revalidate")
    async trackOpen(
        @Query("messageId") messageId: string,
        @Res() res: Response
    ) {
        if (messageId) {
            const row = await this.db.activityContact.findFirst({
                where: {
                    OR: [
                        { message_id: messageId },
                        { ses_message_id: messageId },
                    ],
                },
            });
            if (row) {
                await this.db.activityContact.update({
                    where: { id: row.id },
                    data: {
                        email_opened_at: row.email_opened_at ?? new Date(),
                        email_open_count: (row.email_open_count ?? 0) + 1,
                        modified_at: new Date(),
                    },
                });
            }
        }
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Content-Length", TRANSPARENT_PNG.length);
        res.send(TRANSPARENT_PNG);
    }

    @Get("track-click")
    @ApiOperation({ summary: "Email click tracking redirect (public)" })
    @Redirect("/", 302)
    async trackClick(
        @Query("messageId") messageId: string,
        @Query("url") url?: string
    ) {
        if (messageId) {
            const row = await this.db.activityContact.findFirst({
                where: {
                    OR: [
                        { message_id: messageId },
                        { ses_message_id: messageId },
                    ],
                },
            });
            if (row) {
                await this.db.activityContact.update({
                    where: { id: row.id },
                    data: {
                        email_clicked_at: row.email_clicked_at ?? new Date(),
                        email_click_count: (row.email_click_count ?? 0) + 1,
                        clicked_link: url ? String(url).slice(0, 500) : null,
                        modified_at: new Date(),
                    },
                });
            }
        }
        const target =
            url && /^https?:\/\//i.test(url) ? url : process.env.NEXTAUTH_URL || "/";
        return { url: target };
    }

    @Post("ses-webhook")
    @ApiOperation({ summary: "AWS SES event webhook (public)" })
    async sesWebhook(@Body() body: Record<string, unknown>) {
        // Support both raw SNS envelope and already-parsed SES event.
        let message: Record<string, unknown> = body;
        if (typeof body.Message === "string") {
            try {
                message = JSON.parse(body.Message) as Record<string, unknown>;
            } catch {
                message = body;
            }
        }
        if (body.Type === "SubscriptionConfirmation" && body.SubscribeURL) {
            return { success: true, confirmed: true };
        }

        const mail = message.mail as Record<string, unknown> | undefined;
        const messageId =
            (mail?.messageId as string) ||
            (message.mail as { messageId?: string } | undefined)?.messageId;
        const eventType = String(
            message.eventType || message.notificationType || ""
        );

        if (messageId) {
            const row = await this.db.activityContact.findFirst({
                where: {
                    OR: [
                        { ses_message_id: messageId },
                        { message_id: messageId },
                    ],
                },
            });
            if (row) {
                const data: Record<string, unknown> = {
                    modified_at: new Date(),
                };
                const lower = eventType.toLowerCase();
                if (lower.includes("delivery")) {
                    data.status = "Delivered";
                    data.delivered_at = new Date();
                } else if (lower.includes("bounce")) {
                    data.status = "Bounced";
                    data.bounced_at = new Date();
                    const bounce = message.bounce as
                        | Record<string, unknown>
                        | undefined;
                    data.bounce_type = bounce?.bounceType ?? null;
                    data.bounce_sub_type = bounce?.bounceSubType ?? null;
                } else if (lower.includes("complaint")) {
                    data.complaint_at = new Date();
                } else if (lower.includes("open")) {
                    data.email_opened_at = row.email_opened_at ?? new Date();
                    data.email_open_count = (row.email_open_count ?? 0) + 1;
                } else if (lower.includes("click")) {
                    data.email_clicked_at = row.email_clicked_at ?? new Date();
                    data.email_click_count = (row.email_click_count ?? 0) + 1;
                }
                await this.db.activityContact.update({
                    where: { id: row.id },
                    data,
                });
            }
        }

        return { success: true };
    }
}
