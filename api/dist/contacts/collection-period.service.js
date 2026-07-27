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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectionPeriodService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const VALID_CATEGORIES = [
    "Automated",
    "Promise_to_pay",
    "Dispute",
    "Agent",
    "Legal",
];
let CollectionPeriodService = class CollectionPeriodService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async getById(user, id) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const period = await this.db.customerCollectionPeriod.findUnique({
            where: { id },
            include: { Customer: { select: { account_id: true } } },
        });
        if (!period) {
            throw new common_1.NotFoundException({
                error: `Collection period with ID ${id} not found`,
            });
        }
        if (period.Customer?.account_id !== accountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        return (0, serialize_bigint_1.serializeBigInt)(period);
    }
    async update(user, id, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const period = await this.db.customerCollectionPeriod.findUnique({
            where: { id },
            select: {
                id: true,
                current_category: true,
                customer_id: true,
                Customer: { select: { account_id: true } },
            },
        });
        if (!period) {
            throw new common_1.NotFoundException({
                error: `Collection period with ID ${id} not found`,
            });
        }
        if (period.Customer?.account_id !== accountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        const currentCategory = body.current_category;
        if (!currentCategory) {
            throw new common_1.BadRequestException({
                error: "current_category is required",
            });
        }
        if (!VALID_CATEGORIES.includes(currentCategory)) {
            throw new common_1.BadRequestException({
                error: `Invalid category value. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
                received: currentCategory,
            });
        }
        const updated = await this.db.customerCollectionPeriod.update({
            where: { id },
            data: {
                current_category: currentCategory,
                ...(body.resetStepToZero ? { last_automated_step: 0 } : {}),
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
};
exports.CollectionPeriodService = CollectionPeriodService;
exports.CollectionPeriodService = CollectionPeriodService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], CollectionPeriodService);
//# sourceMappingURL=collection-period.service.js.map