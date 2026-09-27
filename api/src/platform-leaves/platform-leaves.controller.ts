import { Body, Controller, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { DatabaseService } from "../database/database.service";

@ApiTags("platform-leaves")
@Controller("api")
export class PlatformLeavesController {
    constructor(private readonly db: DatabaseService) {}

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
