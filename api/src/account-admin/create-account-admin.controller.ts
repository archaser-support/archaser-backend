import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    Query,
    Type,
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
import {
    AccountAdminEntitiesService,
    AccountAdminEntityType,
    AccountAdminListQuery,
} from "./account-admin-entities.service";

/**
 * One Nest controller per account-admin entity type under `api/entities/<type>`,
 * DualAuth + AccountAdminEntitiesService (Prisma, no bundled handlers).
 */
export function createAccountAdminController(
    entityType: AccountAdminEntityType
): Type<unknown> {
    @ApiTags("entities")
    @ApiBearerAuth()
    @UseGuards(DualAuthGuard)
    @Controller(`api/entities/${entityType}`)
    class AccountAdminEntityController {
        constructor(private readonly service: AccountAdminEntitiesService) {}

        @Get()
        @ApiOperation({
            summary: `${entityType} list (Nest-native)`,
        })
        @ApiUnauthorizedResponse({
            description: "Missing Bearer or session cookie",
        })
        async list(
            @CurrentUser() user: JwtPayload,
            @Query() query: AccountAdminListQuery
        ) {
            return this.service.list(entityType, user, query);
        }

        @Post()
        @ApiOperation({ summary: `${entityType} create (Nest-native)` })
        async create(
            @CurrentUser() user: JwtPayload,
            @Body() body: Record<string, unknown>
        ) {
            if (entityType === "business-units") {
                return this.service.createBusinessUnit(user, body);
            }
            return { error: `Create not supported for ${entityType}` };
        }

        // Declared before `:id` so Nest does not treat the path segment as an id.
        @Get("collection-agents")
        @ApiOperation({
            summary: "Active collection agents (users entity only)",
        })
        async collectionAgents(@CurrentUser() user: JwtPayload) {
            if (entityType !== "users") {
                return this.service.getById(
                    entityType,
                    user,
                    this.service.parseId(entityType, "collection-agents")
                );
            }
            return this.service.listCollectionAgents(user);
        }

        @Put(":id/status")
        @ApiOperation({ summary: `${entityType} status update (Nest-native)` })
        async updateStatus(
            @CurrentUser() user: JwtPayload,
            @Param("id") id: string,
            @Body() body: Record<string, unknown>
        ) {
            if (entityType !== "business-units") {
                return {
                    error: `Status update not supported for ${entityType}`,
                };
            }
            const status = body.status === "Inactive" ? "Inactive" : "Active";
            return this.service.updateBusinessUnitStatus(
                user,
                this.service.parseId(entityType, id) as number,
                status
            );
        }

        @Get(":id")
        @ApiOperation({ summary: `${entityType} detail (Nest-native)` })
        async byId(
            @CurrentUser() user: JwtPayload,
            @Param("id") id: string
        ) {
            return this.service.getById(
                entityType,
                user,
                this.service.parseId(entityType, id)
            );
        }

        @Put(":id")
        @ApiOperation({ summary: `${entityType} update (Nest-native)` })
        async update(
            @CurrentUser() user: JwtPayload,
            @Param("id") id: string,
            @Body() body: Record<string, unknown>
        ) {
            return this.service.update(
                entityType,
                user,
                this.service.parseId(entityType, id),
                body
            );
        }

        @Delete(":id")
        @ApiOperation({ summary: `${entityType} delete (Nest-native)` })
        async remove(
            @CurrentUser() user: JwtPayload,
            @Param("id") id: string,
            @Body() body: Record<string, unknown>
        ) {
            if (entityType !== "business-units") {
                return { error: `Delete not supported for ${entityType}` };
            }
            const reassign =
                body?.reassignToBusinessUnitId == null
                    ? null
                    : Number(body.reassignToBusinessUnitId);
            return this.service.deleteBusinessUnit(
                user,
                this.service.parseId(entityType, id) as number,
                reassign
            );
        }
    }

    Object.defineProperty(AccountAdminEntityController, "name", {
        value: `${entityType
            .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
            .replace(/^./, (c) => c.toUpperCase())}AccountAdminController`,
    });

    return AccountAdminEntityController;
}
