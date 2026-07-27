import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { ImportService } from "./import.service";

@ApiTags("import")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/import")
export class ImportDomainController {
    constructor(private readonly importService: ImportService) {}

    @Post("payment")
    @ApiOperation({ summary: "Payment import (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing auth" })
    async payment(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.importService.importLeaf("payment", user, body);
    }

    @Post("customer")
    @ApiOperation({ summary: "Customer import (Nest-native)" })
    async customer(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.importService.importLeaf("customer", user, body);
    }

    @Post("contact")
    @ApiOperation({ summary: "Contact import (Nest-native)" })
    async contact(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.importService.importLeaf("contact", user, body);
    }

    @Post("invoice")
    @ApiOperation({ summary: "Invoice import (Nest-native)" })
    async invoice(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.importService.importLeaf("invoice", user, body);
    }

    @Post("policy")
    @ApiOperation({ summary: "Policy import (Nest-native)" })
    async policy(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.importService.importLeaf("policy", user, body);
    }

    @Post("job/create")
    @ApiOperation({ summary: "Create import job (Nest-native)" })
    async jobCreate(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.importService.createJob(user, body);
    }

    @Post("job/complete")
    @ApiOperation({ summary: "Complete import job (Nest-native)" })
    async jobComplete(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.importService.completeJob(user, body);
    }

    @Get("job/:jobId")
    @ApiParam({ name: "jobId", description: "Import job id" })
    @ApiOperation({ summary: "Import job status / detail by id (Nest-native)" })
    async jobById(
        @Param("jobId") jobId: string,
        @CurrentUser() user: JwtPayload
    ) {
        return this.importService.getJobById(user, jobId);
    }
}
