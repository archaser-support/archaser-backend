import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Query,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { ActivitiesService } from "./activities.service";

@ApiTags("activities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/activities")
export class ActivitiesController {
    constructor(private readonly activities: ActivitiesService) {}

    // ── Sequences ──────────────────────────────────────────────

    @Get("sequences")
    @ApiOperation({ summary: "List activity sequences (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async listSequences(
        @CurrentUser() user: JwtPayload,
        @Query() query: { account_id?: string; sequence_container_id?: string }
    ) {
        return this.activities.listSequences(user, query);
    }

    @Get("sequences/:id")
    @ApiOperation({ summary: "Get activity sequence by id" })
    async getSequence(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.activities.getSequence(user, id);
    }

    @Post("sequences")
    @HttpCode(201)
    @ApiOperation({ summary: "Create activity sequence" })
    async createSequence(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.activities.createSequence(user, body);
    }

    @Put("sequences/:id")
    @ApiOperation({ summary: "Update activity sequence" })
    async updateSequence(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.activities.updateSequence(user, id, body);
    }

    @Put("sequences/:id/:operation")
    @ApiOperation({ summary: "Update activity sequence (operation)" })
    async updateSequenceOp(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Param("operation") operation: string,
        @Body() body: Record<string, unknown>
    ) {
        return this.activities.updateSequence(user, id, body, operation);
    }

    @Delete("sequences/:id")
    @HttpCode(204)
    @ApiOperation({ summary: "Delete activity sequence" })
    async deleteSequence(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        await this.activities.deleteSequence(user, id);
    }

    // ── Templates ──────────────────────────────────────────────

    @Get("templates")
    @ApiOperation({ summary: "List activity templates" })
    async listTemplates(
        @CurrentUser() user: JwtPayload,
        @Query() query: Record<string, string | undefined>
    ) {
        return this.activities.listTemplates(user, query);
    }

    @Get("templates/:id")
    @ApiOperation({ summary: "Get activity template by id" })
    async getTemplate(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.activities.getTemplate(user, id);
    }

    @Get("templates/:id/:operation")
    @ApiOperation({ summary: "Template operation (e.g. check-usage)" })
    async getTemplateOp(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Param("operation") operation: string
    ) {
        return this.activities.getTemplate(user, id, operation);
    }

    @Post("templates")
    @HttpCode(201)
    @ApiOperation({ summary: "Create activity template" })
    async createTemplate(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.activities.createTemplate(user, body);
    }

    @Put("templates/:id")
    @ApiOperation({ summary: "Update activity template" })
    async updateTemplate(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.activities.updateTemplate(user, id, body);
    }

    @Put("templates/:id/:operation")
    @ApiOperation({ summary: "Update activity template (operation)" })
    async updateTemplateOp(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Param("operation") operation: string,
        @Body() body: Record<string, unknown>
    ) {
        return this.activities.updateTemplate(user, id, body, operation);
    }

    @Delete("templates/:id")
    @HttpCode(204)
    @ApiOperation({ summary: "Delete activity template" })
    async deleteTemplate(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        await this.activities.deleteTemplate(user, id);
    }

    // ── Attachments ────────────────────────────────────────────

    @Get("attachments")
    @ApiOperation({ summary: "List activity attachments" })
    async listAttachments(
        @CurrentUser() user: JwtPayload,
        @Query("activityId") activityId: string
    ) {
        return this.activities.listAttachments(user, activityId);
    }

    @Post("attachments/presigned-url")
    @ApiOperation({ summary: "Generate attachment download URL (S3 or stub)" })
    async presignedUrl(@Body() body: { filePath?: string; expiresIn?: number }) {
        return this.activities.getPresignedUrl(body);
    }

    @Delete("attachments/:id")
    @ApiOperation({ summary: "Delete activity attachment" })
    async deleteAttachment(
        @CurrentUser() user: JwtPayload,
        @Param("id") id: string
    ) {
        return this.activities.deleteAttachment(user, id);
    }
}
