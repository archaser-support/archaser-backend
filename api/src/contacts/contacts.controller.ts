import {
    Body,
    Controller,
    Delete,
    Get,
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
import { ContactsListQuery, ContactsService } from "./contacts.service";

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/contacts")
export class ContactsController {
    constructor(private readonly contacts: ContactsService) {}

    @Get()
    @ApiOperation({ summary: "Contacts list (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: ContactsListQuery
    ) {
        return this.contacts.list(user, query);
    }

    @Put()
    @ApiOperation({
        summary:
            "Collection-level contact update (availability via ?operation=availability)",
    })
    async updateCollection(
        @CurrentUser() user: JwtPayload,
        @Query() query: ContactsListQuery,
        @Body() body: Record<string, unknown>
    ) {
        return this.contacts.updateAvailability(user, query, body);
    }

    @Post()
    @ApiOperation({
        summary:
            "Create or update a contact (Nest-native). Body with id updates; without id creates.",
    })
    async upsert(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.contacts.upsert(user, body);
    }

    @Get(":id")
    @ApiOperation({ summary: "Contact detail (Nest-native)" })
    async byId(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.contacts.getById(user, id);
    }

    @Put(":id")
    @ApiOperation({
        summary:
            "Update contact — status-only deactivate or full field update (Nest-native)",
    })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.contacts.update(user, id, body);
    }

    @Delete(":id")
    @ApiOperation({ summary: "Delete a contact (Nest-native)" })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.contacts.remove(user, id);
    }
}
