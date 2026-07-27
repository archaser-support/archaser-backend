import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

/** Public reference data (legacy country/state endpoints are unauthenticated). */
@ApiTags("reference-data")
@Controller("api")
export class ReferenceDataController {
    constructor(private readonly db: DatabaseService) {}

    @Get("country")
    @ApiOperation({ summary: "List countries (public reference)" })
    async countries() {
        const countries = await this.db.country.findMany({
            select: {
                id: true,
                name: true,
                iso2: true,
                iso3: true,
                phonecode: true,
                emoji: true,
            },
            orderBy: { name: "asc" },
        });
        return serializeBigInt(countries);
    }

    @Get("state")
    @ApiOperation({ summary: "List states (public reference)" })
    async states(@Query("country_id") countryIdRaw?: string) {
        const where: Record<string, unknown> = {};
        if (countryIdRaw) {
            const countryId = parseInt(countryIdRaw, 10);
            if (Number.isFinite(countryId)) {
                where.country_id = countryId;
            }
        }
        const states = await this.db.state.findMany({
            where,
            select: {
                id: true,
                name: true,
                country_id: true,
                country_code: true,
                iso2: true,
            },
            orderBy: { name: "asc" },
        });
        return serializeBigInt(states);
    }
}
