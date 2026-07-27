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
exports.ReferenceDataController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let ReferenceDataController = class ReferenceDataController {
    constructor(db) {
        this.db = db;
    }
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
        return (0, serialize_bigint_1.serializeBigInt)(countries);
    }
    async states(countryIdRaw) {
        const where = {};
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
        return (0, serialize_bigint_1.serializeBigInt)(states);
    }
};
exports.ReferenceDataController = ReferenceDataController;
__decorate([
    (0, common_1.Get)("country"),
    (0, swagger_1.ApiOperation)({ summary: "List countries (public reference)" }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ReferenceDataController.prototype, "countries", null);
__decorate([
    (0, common_1.Get)("state"),
    (0, swagger_1.ApiOperation)({ summary: "List states (public reference)" }),
    __param(0, (0, common_1.Query)("country_id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ReferenceDataController.prototype, "states", null);
exports.ReferenceDataController = ReferenceDataController = __decorate([
    (0, swagger_1.ApiTags)("reference-data"),
    (0, common_1.Controller)("api"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], ReferenceDataController);
//# sourceMappingURL=reference-data.controller.js.map