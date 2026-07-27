import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HealthService, HealthResponse } from "./health.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
    constructor(private readonly healthService: HealthService) {}

    @Get()
    @ApiOperation({
        summary: "Liveness/readiness spike including trivial Postgres read",
    })
    @ApiOkResponse({ description: "Service health including database probe" })
    getHealth(): Promise<HealthResponse> {
        return this.healthService.getHealth();
    }
}
