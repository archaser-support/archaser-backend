import {
    Body,
    Controller,
    Headers,
    Post,
    Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { DatabaseService } from "../database/database.service";

@ApiTags("errors")
@Controller("api/errors")
export class ErrorsController {
    constructor(private readonly db: DatabaseService) {}

    @Post("report")
    @ApiOperation({
        summary: "Client error report (Nest-native, structured ack)",
    })
    async report(
        @Body() body: Record<string, unknown>,
        @Headers("user-agent") userAgentHeader?: string,
        @Headers("referer") refererHeader?: string,
        @Req() req?: Request
    ) {
        const errorMessage =
            typeof body.errorMessage === "string"
                ? body.errorMessage
                : "unknown";

        let accountName: string | undefined;
        const accountId =
            typeof body.accountId === "number"
                ? body.accountId
                : typeof (req as Request & { user?: { account_id?: number } })
                        ?.user?.account_id === "number"
                  ? (req as Request & { user?: { account_id?: number } }).user!
                        .account_id
                  : undefined;

        if (accountId != null) {
            try {
                const account = await this.db.account.findUnique({
                    where: { id: accountId },
                    select: { name: true },
                });
                accountName = account?.name ?? undefined;
            } catch {
                // non-critical
            }
        }

        const context = {
            errorMessage,
            errorName: body.errorName,
            errorDigest: body.errorDigest,
            page: body.page,
            component: body.component,
            userAgent: body.userAgent || userAgentHeader,
            referrer: body.referrer || refererHeader,
            accountId,
            accountName,
            timestamp: new Date().toISOString(),
        };

        // eslint-disable-next-line no-console
        console.error("[errors/report]", JSON.stringify(context));

        return {
            success: true,
            received: true,
            timestamp: context.timestamp,
        };
    }
}
