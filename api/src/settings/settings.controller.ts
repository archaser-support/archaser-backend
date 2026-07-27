import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { DatabaseService } from "../database/database.service";

@ApiTags("settings")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/settings")
export class SettingsController {
    constructor(private readonly db: DatabaseService) {}

    @Get("currency-rates")
    @ApiOperation({ summary: "Latest currency rates (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async currencyRates(
        @Query("page") pageRaw?: string,
        @Query("limit") limitRaw?: string,
        @Query("query") searchRaw?: string,
        @Query("sortField") sortFieldRaw?: string,
        @Query("sortDirection") sortDirectionRaw?: string
    ) {
        const page = Math.max(1, parseInt(pageRaw || "1", 10) || 1);
        const limit = Math.min(
            10000,
            Math.max(1, parseInt(limitRaw || "20", 10) || 20)
        );
        const search = String(searchRaw || "").trim();
        const sortField = [
            "rate_date",
            "base_currency",
            "other_currency",
            "currency_ratio",
        ].includes(sortFieldRaw || "")
            ? (sortFieldRaw as string)
            : "rate_date";
        const sortDirection =
            String(sortDirectionRaw || "desc").toLowerCase() === "asc"
                ? "asc"
                : "desc";

        const grouped = await this.db.currencyRate.groupBy({
            by: ["base_currency", "other_currency"],
            _max: { rate_date: true },
        });

        const pairs = search
            ? grouped.filter(
                  (g) =>
                      g.base_currency
                          .toUpperCase()
                          .includes(search.toUpperCase()) ||
                      g.other_currency
                          .toUpperCase()
                          .includes(search.toUpperCase())
              )
            : grouped;

        const latestRows = await Promise.all(
            pairs.map(async (g) => {
                return this.db.currencyRate.findFirst({
                    where: {
                        base_currency: g.base_currency,
                        other_currency: g.other_currency,
                        rate_date: g._max.rate_date ?? undefined,
                    },
                });
            })
        );

        const rates = latestRows
            .filter((r): r is NonNullable<typeof r> => !!r)
            .sort((a, b) => {
                const dir = sortDirection === "asc" ? 1 : -1;
                const av = a[sortField as keyof typeof a];
                const bv = b[sortField as keyof typeof b];
                if (av == null || bv == null) return 0;
                if (av < bv) return -1 * dir;
                if (av > bv) return 1 * dir;
                return b.id - a.id;
            });

        const skip = (page - 1) * limit;
        const pageRows = rates.slice(skip, skip + limit);

        return {
            rates: pageRows.map((row) => ({
                id: row.id,
                rate_date: row.rate_date.toISOString().slice(0, 10),
                base_currency: row.base_currency,
                other_currency: row.other_currency,
                currency_ratio: Number(row.currency_ratio),
            })),
            totalRecords: rates.length,
        };
    }
}
