import { Body, Controller, Param, Post, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { GatewayProxyService } from "./gateway-proxy.service";

/**
 * Optional peel forwarders — when SERVICE_URL env is set, gateway proxies
 * instead of (or after) in-monolith strangler for execute/send paths.
 */
@ApiTags("gateway-peel")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/gateway")
export class GatewayPeelController {
    constructor(private readonly proxy: GatewayProxyService) {}

    @Post("sms/send")
    @ApiOperation({ summary: "Forward SMS send to archaser-sms when configured" })
    async smsSend(@Body() body: unknown, @Res() res: Response): Promise<void> {
        const result = await this.proxy.forward("sms", "/internal/send", {
            method: "POST",
            body: JSON.stringify(body ?? {}),
        });
        res.status(result.status).json(result.body);
    }

    @Post("connectors/:accountId/sync")
    @ApiOperation({ summary: "Forward connector sync to archaser-connectors" })
    async connectorSync(
        @Param("accountId") accountId: string,
        @Body() body: unknown,
        @Res() res: Response
    ): Promise<void> {
        const result = await this.proxy.forward(
            "connectors",
            `/internal/accounts/${accountId}/sync`,
            { method: "POST", body: JSON.stringify(body ?? {}) }
        );
        res.status(result.status).json(result.body);
    }

    @Post("reports/:id/execute")
    @ApiOperation({ summary: "Forward report execute to archaser-reports" })
    async reportExecute(
        @Param("id") id: string,
        @Body() body: unknown,
        @Res() res: Response
    ): Promise<void> {
        const result = await this.proxy.forward(
            "reports",
            `/internal/reports/${id}/execute`,
            { method: "POST", body: JSON.stringify(body ?? {}) }
        );
        res.status(result.status).json(result.body);
    }
}
