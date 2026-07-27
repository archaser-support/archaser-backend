"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const database_service_1 = require("../database/database.service");
let SettingsController = class SettingsController {
    constructor(db) {
        this.db = db;
    }
    async currencyRates(pageRaw, limitRaw, searchRaw, sortFieldRaw, sortDirectionRaw) {
        const page = Math.max(1, parseInt(pageRaw || "1", 10) || 1);
        const limit = Math.min(10000, Math.max(1, parseInt(limitRaw || "20", 10) || 20));
        const search = String(searchRaw || "").trim();
        const sortField = [
            "rate_date",
            "base_currency",
            "other_currency",
            "currency_ratio",
        ].includes(sortFieldRaw || "")
            ? sortFieldRaw
            : "rate_date";
        const sortDirection = String(sortDirectionRaw || "desc").toLowerCase() === "asc"
            ? "asc"
            : "desc";
        const grouped = await this.db.currencyRate.groupBy({
            by: ["base_currency", "other_currency"],
            _max: { rate_date: true },
        });
        const pairs = search
            ? grouped.filter((g) => g.base_currency
                .toUpperCase()
                .includes(search.toUpperCase()) ||
                g.other_currency
                    .toUpperCase()
                    .includes(search.toUpperCase()))
            : grouped;
        const latestRows = await Promise.all(pairs.map(async (g) => {
            return this.db.currencyRate.findFirst({
                where: {
                    base_currency: g.base_currency,
                    other_currency: g.other_currency,
                    rate_date: g._max.rate_date ?? undefined,
                },
            });
        }));
        const rates = latestRows
            .filter((r) => !!r)
            .sort((a, b) => {
            const dir = sortDirection === "asc" ? 1 : -1;
            const av = a[sortField];
            const bv = b[sortField];
            if (av == null || bv == null)
                return 0;
            if (av < bv)
                return -1 * dir;
            if (av > bv)
                return 1 * dir;
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
};
exports.SettingsController = SettingsController;
__decorate([
    (0, common_1.Get)("currency-rates"),
    (0, swagger_1.ApiOperation)({ summary: "Latest currency rates (Nest-native)" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, common_1.Query)("page")),
    __param(1, (0, common_1.Query)("limit")),
    __param(2, (0, common_1.Query)("query")),
    __param(3, (0, common_1.Query)("sortField")),
    __param(4, (0, common_1.Query)("sortDirection")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "currencyRates", null);
exports.SettingsController = SettingsController = __decorate([
    (0, swagger_1.ApiTags)("settings"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/settings"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], SettingsController);
//# sourceMappingURL=settings.controller.js.map