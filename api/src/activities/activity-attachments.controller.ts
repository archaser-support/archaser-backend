import {
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Req,
    Res,
    UploadedFiles,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import {
    ApiBearerAuth,
    ApiConsumes,
    ApiOperation,
    ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { ActivitiesService } from "./activities.service";

/**
 * Legacy URL alias used by the UI (`/api/activity-attachments`).
 * Primary Nest routes also live under `/api/activities/attachments`.
 */
@ApiTags("activity-attachments")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/activity-attachments")
export class ActivityAttachmentsController {
    constructor(private readonly activities: ActivitiesService) {}

    @Post()
    @ApiConsumes("multipart/form-data")
    @ApiOperation({ summary: "Upload activity attachments (Nest-native)" })
    @UseInterceptors(FilesInterceptor("files", 10))
    async upload(
        @CurrentUser() user: JwtPayload,
        @UploadedFiles()
        files: Array<{
            originalname: string;
            mimetype: string;
            size: number;
            buffer?: Buffer;
        }>,
        @Req() req: { body?: Record<string, unknown> }
    ) {
        const activityId = String(req.body?.activityId || "");
        return this.activities.uploadAttachments(user, activityId, files || []);
    }

    @Get(":id")
    @ApiOperation({ summary: "Download activity attachment (redirect)" })
    async download(
        @CurrentUser() user: JwtPayload,
        @Param("id") id: string,
        @Res() res: Response
    ) {
        const result = await this.activities.getAttachmentDownload(user, id);
        if (result.redirectUrl) {
            return res.redirect(result.redirectUrl);
        }
        return res.json(result.attachment);
    }

    @Delete(":id")
    @ApiOperation({ summary: "Delete activity attachment" })
    async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
        return this.activities.deleteAttachment(user, id);
    }
}
