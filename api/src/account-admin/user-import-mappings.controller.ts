import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    NotFoundException,
    Param,
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
import type { ImportType, Prisma } from "@prisma/client";
import { AccessScopeService } from "../auth/access-scope.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";

const IMPORT_TYPES = [
    "Invoice",
    "Customer",
    "Contact",
    "Payment",
    "Policy",
] as const;

function parseImportType(value: unknown): ImportType {
    const match = IMPORT_TYPES.find(
        (type) => type.toLowerCase() === String(value ?? "").trim().toLowerCase()
    );
    if (!match) {
        throw new BadRequestException({
            error: `import_type must be one of: ${IMPORT_TYPES.join(", ")}`,
        });
    }
    return match as ImportType;
}

function parseMapping(value: unknown): Prisma.InputJsonValue {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        throw new BadRequestException({
            error: "mapping must be an object of dbField -> fileColumn",
        });
    }
    return value as Prisma.InputJsonValue;
}

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/users/import-mappings")
export class UserImportMappingsController {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    /** Mappings belong to the acting user, including while viewing as someone else. */
    private async currentUserId(user: JwtPayload): Promise<string> {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveUserId(userInfo);
    }

    private async ownedMappingOrThrow(userId: string, id: string) {
        const mapping = await this.db.userImportMappings.findFirst({
            where: { id, user_id: userId },
        });
        if (!mapping) {
            throw new NotFoundException({ error: "Mapping not found" });
        }
        return mapping;
    }

    /** Only one mapping per user + import type may carry the default flag. */
    private async clearOtherDefaults(
        userId: string,
        importType: ImportType,
        keepId?: string
    ) {
        await this.db.userImportMappings.updateMany({
            where: {
                user_id: userId,
                import_type: importType,
                is_default: true,
                ...(keepId ? { id: { not: keepId } } : {}),
            },
            data: { is_default: false },
        });
    }

    @Get()
    @ApiOperation({ summary: "List the caller's saved import field mappings" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query("import_type") importType?: string
    ) {
        const userId = await this.currentUserId(user);
        const mappings = await this.db.userImportMappings.findMany({
            where: {
                user_id: userId,
                ...(importType
                    ? { import_type: parseImportType(importType) }
                    : {}),
            },
            orderBy: [{ is_default: "desc" }, { modified_at: "desc" }],
        });
        return { mappings };
    }

    @Post()
    @ApiOperation({ summary: "Create a saved import field mapping" })
    async create(
        @CurrentUser() user: JwtPayload,
        @Body()
        body: {
            import_type?: unknown;
            mapping?: unknown;
            name?: unknown;
            is_default?: unknown;
        }
    ) {
        const userId = await this.currentUserId(user);
        const importType = parseImportType(body.import_type);
        const mapping = parseMapping(body.mapping);
        const name =
            typeof body.name === "string" && body.name.trim() !== ""
                ? body.name.trim()
                : `Default ${importType} Mapping`;
        const isDefault = body.is_default !== false;

        if (isDefault) {
            await this.clearOtherDefaults(userId, importType);
        }

        // `name` is unique per user + import type, so a repeat save updates in place.
        const created = await this.db.userImportMappings.upsert({
            where: {
                user_id_import_type_name: {
                    user_id: userId,
                    import_type: importType,
                    name,
                },
            },
            create: {
                user_id: userId,
                import_type: importType,
                mapping,
                name,
                is_default: isDefault,
                created_by: userId,
                modified_by: userId,
            },
            update: {
                mapping,
                is_default: isDefault,
                modified_by: userId,
            },
        });

        return { mapping: created };
    }

    @Get(":id")
    @ApiOperation({ summary: "Get one saved import field mapping" })
    async byId(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
        const userId = await this.currentUserId(user);
        const mapping = await this.ownedMappingOrThrow(userId, id);
        return { mapping };
    }

    @Put(":id")
    @ApiOperation({ summary: "Update a saved import field mapping" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id") id: string,
        @Body()
        body: { mapping?: unknown; name?: unknown; is_default?: unknown }
    ) {
        const userId = await this.currentUserId(user);
        const existing = await this.ownedMappingOrThrow(userId, id);

        const isDefault =
            typeof body.is_default === "boolean"
                ? body.is_default
                : existing.is_default;
        if (isDefault) {
            await this.clearOtherDefaults(userId, existing.import_type, id);
        }

        const updated = await this.db.userImportMappings.update({
            where: { id },
            data: {
                ...(body.mapping === undefined
                    ? {}
                    : { mapping: parseMapping(body.mapping) }),
                ...(typeof body.name === "string" && body.name.trim() !== ""
                    ? { name: body.name.trim() }
                    : {}),
                is_default: isDefault,
                modified_by: userId,
            },
        });

        return { mapping: updated };
    }

    @Delete(":id")
    @HttpCode(200)
    @ApiOperation({ summary: "Delete a saved import field mapping" })
    async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
        const userId = await this.currentUserId(user);
        await this.ownedMappingOrThrow(userId, id);
        await this.db.userImportMappings.delete({ where: { id } });
        return { success: true };
    }
}
