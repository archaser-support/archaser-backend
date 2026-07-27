import { Controller, Get, Header, Res } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { MetricsService } from "./metrics.service";

@ApiTags("metrics")
@Controller("metrics")
export class MetricsController {
    constructor(private readonly metricsService: MetricsService) {}

    @Get()
    @ApiOperation({ summary: "Prometheus metrics scrape endpoint" })
    @ApiOkResponse({ description: "Prometheus text exposition format" })
    @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
    async metrics(@Res() res: Response): Promise<void> {
        const body = await this.metricsService.metricsText();
        res.send(body);
    }
}
