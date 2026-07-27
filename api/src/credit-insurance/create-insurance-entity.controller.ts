import {
    Body,
    Controller,
    Get,
    Param,
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
    InsuranceEntitiesService,
    InsuranceEntityListQuery,
    InsuranceEntityType,
} from "./insurance-entities.service";

/**
 * One Nest controller per insurance entity type under `api/entities/<type>`,
 * DualAuth + InsuranceEntitiesService (Prisma, no bundled handlers).
 */
export function createInsuranceEntityController(
    entityType: InsuranceEntityType
): Type<unknown> {
    @ApiTags("entities")
    @ApiBearerAuth()
    @UseGuards(DualAuthGuard)
    @Controller(`api/entities/${entityType}`)
    class InsuranceEntityController {
        constructor(private readonly service: InsuranceEntitiesService) {}

        @Get()
        @ApiOperation({ summary: `${entityType} list (Nest-native)` })
        @ApiUnauthorizedResponse({
            description: "Missing Bearer or session cookie",
        })
        async list(
            @CurrentUser() user: JwtPayload,
            @Query() query: InsuranceEntityListQuery
        ) {
            return this.service.list(entityType, user, query);
        }

        @Get(":id")
        @ApiOperation({ summary: `${entityType} detail (Nest-native)` })
        async byId(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
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
    }

    Object.defineProperty(InsuranceEntityController, "name", {
        value: `${entityType.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase())}InsuranceEntityController`,
    });

    return InsuranceEntityController;
}
