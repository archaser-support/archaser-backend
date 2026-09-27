import {
    Controller,
    Get,
    Headers,
    Query,
    UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AlertDetailsService } from "./alert-details.service";

@ApiTags("alert-details")
@Controller("api")
export class AlertDetailsController {
    constructor(private readonly alertDetailsService: AlertDetailsService) {}

    @Get("alert-details")
    @ApiOperation({
        summary: "Alert enrichment details for SNS Lambda (API key)",
    })
    async alertDetails(
        @Headers("x-api-key") apiKey: string | undefined,
        @Query("type") type: string,
        @Query("limit") limitRaw?: string
    ) {
        if (apiKey !== process.env.ALERT_DETAILS_API_KEY) {
            throw new UnauthorizedException({ error: "Unauthorized" });
        }
        const limitNum = Math.min(parseInt(limitRaw || "10", 10) || 10, 50);
        return this.alertDetailsService.getDetails(type || "", limitNum);
    }
}
