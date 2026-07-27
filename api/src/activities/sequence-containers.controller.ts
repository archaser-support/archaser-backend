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
import { SequenceContainersService } from "./sequence-containers.service";

@ApiTags("sequenceContainers")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/sequenceContainers")
export class SequenceContainersController {
    constructor(private readonly containers: SequenceContainersService) {}

    @Get()
    @ApiOperation({ summary: "List sequence containers by category" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query("category") category: string,
        @Query("includeInactive") includeInactive?: string
    ) {
        return this.containers.list(
            user,
            category,
            includeInactive === "true"
        );
    }

    @Post()
    @HttpCode(201)
    @ApiOperation({ summary: "Create sequence container" })
    async create(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.containers.create(user, body);
    }

    @Get(":id")
    @ApiOperation({ summary: "Get sequence container (or usage)" })
    async getById(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Query("usage") usage?: string
    ) {
        if (usage === "true") {
            return this.containers.getUsage(user, id);
        }
        return this.containers.getById(user, id);
    }

    @Put(":id")
    @ApiOperation({ summary: "Update sequence container" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.containers.update(user, id, body);
    }

    @Delete(":id")
    @ApiOperation({ summary: "Soft-delete sequence container" })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.containers.delete(user, id);
    }

    @Post(":id")
    @ApiOperation({
        summary: "Sequence container actions (clone, setDefault, deleteWithReplacement)",
    })
    async action(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.containers.postAction(user, id, body);
    }
}
