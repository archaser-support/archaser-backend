import {
    Controller,
    Get,
    Query,
    Req,
    Res,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import {
    DualAuthGuard,
    DualAuthRequest,
} from "../auth/dual-auth.guard";
import { RealtimeHubService } from "./realtime-hub.service";

function writeSseHeaders(res: Response, origin: string | undefined): void {
    const headers: Record<string, string> = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    };
    if (origin) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
    }
    res.writeHead(200, headers);
    res.write(": ok\n\n");
}

@ApiTags("realtime")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/ws")
export class RealtimeWsController {
    constructor(private readonly hub: RealtimeHubService) {}

    @Get("notifications")
    @ApiOperation({
        summary:
            "SSE notification stream (Nest-owned). EventSource may pass ?access_token= for Amplify cross-origin.",
    })
    notifications(
        @Req() req: DualAuthRequest,
        @Res() res: Response,
        @Query("access_token") _accessToken?: string
    ): void {
        const user = req.user!;
        const origin = req.headers.origin;
        writeSseHeaders(res, typeof origin === "string" ? origin : undefined);

        const clientId = `${user.sub}-notif-${Date.now()}`;
        this.hub.addNotificationClient({
            id: clientId,
            userId: user.sub,
            accountId: user.account_id ?? null,
            hasViewAsPermission: false,
            res,
        });

        res.write(
            `data: ${JSON.stringify({
                type: "connected",
                message: "Notification SSE connected",
                userId: user.sub,
                timestamp: new Date().toISOString(),
            })}\n\n`
        );

        const heartbeat = setInterval(() => {
            try {
                if (!res.writable || res.destroyed) {
                    clearInterval(heartbeat);
                    return;
                }
                res.write(`: heartbeat ${Date.now()}\n\n`);
            } catch {
                clearInterval(heartbeat);
            }
        }, 25000);

        const cleanup = () => {
            clearInterval(heartbeat);
            this.hub.removeNotificationClient(clientId);
        };
        req.on("close", cleanup);
        res.on("close", cleanup);
    }

    @Get("control-center")
    @ApiOperation({
        summary:
            "SSE control-center stream (Nest-owned). EventSource may pass ?access_token=.",
    })
    controlCenter(
        @Req() req: DualAuthRequest,
        @Res() res: Response,
        @Query("access_token") _accessToken?: string
    ): void {
        const user = req.user!;
        const origin = req.headers.origin;
        writeSseHeaders(res, typeof origin === "string" ? origin : undefined);

        const clientId = `${user.sub}-cc-${Date.now()}`;
        this.hub.addControlCenterClient({
            id: clientId,
            userId: user.sub,
            accountId: user.account_id ?? null,
            hasViewAsPermission: false,
            res,
        });

        res.write(
            `data: ${JSON.stringify({
                type: "connected",
                message: "Control Center SSE connected",
                userId: user.sub,
            })}\n\n`
        );

        const heartbeat = setInterval(() => {
            try {
                if (!res.writable || res.destroyed) {
                    clearInterval(heartbeat);
                    return;
                }
                res.write(`: heartbeat ${Date.now()}\n\n`);
            } catch {
                clearInterval(heartbeat);
            }
        }, 25000);

        const cleanup = () => {
            clearInterval(heartbeat);
            this.hub.removeControlCenterClient(clientId);
        };
        req.on("close", cleanup);
        res.on("close", cleanup);
    }
}
