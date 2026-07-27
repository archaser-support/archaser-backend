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
import { InternalEmailTemplatesService } from "./internal-email-templates.service";

@ApiTags("internalEmailTemplates")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/internalEmailTemplates")
export class InternalEmailTemplatesController {
    constructor(
        private readonly templates: InternalEmailTemplatesService
    ) {}

    @Get()
    @ApiOperation({ summary: "List internal email templates" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(@CurrentUser() user: JwtPayload) {
        return this.templates.list(user);
    }

    @Get("master")
    @ApiOperation({ summary: "List or get master internal email templates" })
    async master(
        @CurrentUser() _user: JwtPayload,
        @Query("type") type?: string
    ) {
        return this.templates.listMaster(type);
    }

    @Post()
    @HttpCode(201)
    @ApiOperation({ summary: "Create internal email template" })
    async create(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.templates.create(user, body);
    }

    @Get(":id")
    @ApiOperation({ summary: "Get internal email template by id" })
    async getById(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.templates.getById(user, id);
    }

    @Put(":id")
    @ApiOperation({ summary: "Update internal email template" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.templates.update(user, id, body);
    }

    @Delete(":id")
    @HttpCode(204)
    @ApiOperation({ summary: "Delete internal email template" })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        await this.templates.delete(user, id);
    }

    @Post(":id/test-email")
    @ApiOperation({ summary: "Dry-run test email for a template" })
    async testEmail(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: { emailSubject?: string; emailContent?: string }
    ) {
        return this.templates.testEmail(user, id, body);
    }
}
