import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { createHash, randomUUID } from "crypto";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";

/**
 * Presign stub for S3 uploads. Returns a synthetic upload URL when AWS_* env
 * vars are present; otherwise returns a local stub path the UI can treat as ok.
 */
@ApiTags("upload")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/upload")
export class UploadController {
    @Post("s3")
    @ApiOperation({ summary: "S3 upload / presign stub (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async s3(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        const accountId =
            typeof body.accountId === "number"
                ? body.accountId
                : user.account_id;
        const activityId =
            typeof body.activityId === "string"
                ? body.activityId
                : "logo";
        const fileName =
            typeof body.fileName === "string"
                ? body.fileName
                : typeof body.filename === "string"
                  ? body.filename
                  : `upload-${randomUUID()}`;
        const contentType =
            typeof body.contentType === "string"
                ? body.contentType
                : "application/octet-stream";

        const bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET;
        const region = process.env.AWS_REGION || "us-east-1";
        const accessKey = process.env.AWS_ACCESS_KEY_ID;
        const key = `accounts/${accountId}/${activityId}/${Date.now()}-${fileName}`;

        if (bucket && accessKey) {
            const hash = createHash("sha256")
                .update(`${key}:${user.sub}:${Date.now()}`)
                .digest("hex")
                .slice(0, 16);
            const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
            return {
                success: true,
                bucket,
                region,
                key,
                filePath: key,
                contentType,
                uploadUrl: `${publicUrl}?X-Amz-Stub=${hash}`,
                publicUrl,
                url: publicUrl,
                stub: true,
            };
        }

        const publicUrl = `/uploads/${encodeURIComponent(key)}`;
        return {
            success: true,
            key,
            filePath: key,
            contentType,
            uploadUrl: `/api/upload/local-stub/${encodeURIComponent(key)}`,
            publicUrl,
            url: publicUrl,
            stub: true,
            message:
                "AWS_* not configured — returning Nest-native local stub URLs",
        };
    }
}
