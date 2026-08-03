import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { InternalSecretGuard } from "../auth/internal-secret.guard";
import { SmsService } from "../sms/sms.service";

@ApiTags("internal-sms")
@UseGuards(InternalSecretGuard)
@Controller("internal/sms")
export class InternalSmsController {
    constructor(private readonly sms: SmsService) {}

    @Post("send")
    @ApiOperation({
        summary: "Service-to-service SMS send (x-internal-service-secret)",
    })
    async send(@Body() body: Record<string, unknown>) {
        return this.sms.sendInternal(body);
    }
}
