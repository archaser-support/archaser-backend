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
exports.InsuranceEntitiesService = exports.INSURANCE_ENTITY_TYPES = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
exports.INSURANCE_ENTITY_TYPES = [
    "insurance-policies",
    "insurance-policy-countries",
    "insurance-policy-named-policies",
];
const ENTITY_CONFIG = {
    "insurance-policies": {
        delegate: "insurancePolicy",
        listKey: "policies",
        direct: true,
        idType: "number",
    },
    "insurance-policy-countries": {
        delegate: "insurancePolicyCountry",
        listKey: "countries",
        direct: false,
        idType: "string",
    },
    "insurance-policy-named-policies": {
        delegate: "namedPolicy",
        listKey: "namedPolicies",
        direct: false,
        idType: "number",
    },
};
let InsuranceEntitiesService = class InsuranceEntitiesService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    delegate(entityType) {
        const config = ENTITY_CONFIG[entityType];
        return this.db[config.delegate];
    }
    async accountId(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveAccountId(userInfo);
    }
    parseId(entityType, raw) {
        const config = ENTITY_CONFIG[entityType];
        if (config.idType === "string") {
            return raw;
        }
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed)) {
            throw new common_1.NotFoundException({ error: "Invalid id" });
        }
        return parsed;
    }
    async list(entityType, user, query) {
        const config = ENTITY_CONFIG[entityType];
        const accountId = await this.accountId(user);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "50", 10);
        const where = config.direct
            ? { account_id: accountId }
            : { InsurancePolicy: { account_id: accountId } };
        const delegate = this.delegate(entityType);
        const [rows, totalRecords] = await Promise.all([
            delegate.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { id: "asc" },
            }),
            delegate.count({ where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({
            [config.listKey]: rows,
            totalRecords,
            page,
            limit,
        });
    }
    async getById(entityType, user, id) {
        const config = ENTITY_CONFIG[entityType];
        const accountId = await this.accountId(user);
        const delegate = this.delegate(entityType);
        const row = config.direct
            ? await delegate.findUnique({ where: { id } })
            : await delegate.findUnique({
                where: { id },
                include: {
                    InsurancePolicy: { select: { account_id: true } },
                },
            });
        if (!row) {
            throw new common_1.NotFoundException({ error: `${entityType} not found` });
        }
        const scopeAccountId = config.direct
            ? row.account_id
            : row.InsurancePolicy?.account_id;
        if (scopeAccountId !== accountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        return (0, serialize_bigint_1.serializeBigInt)(row);
    }
    async update(entityType, user, id, body) {
        await this.getById(entityType, user, id);
        const data = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.insurance_policy_id;
        delete data.created_at;
        delete data.created_by;
        delete data.InsurancePolicy;
        const delegate = this.delegate(entityType);
        const updated = await delegate.update({ where: { id }, data });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
};
exports.InsuranceEntitiesService = InsuranceEntitiesService;
exports.InsuranceEntitiesService = InsuranceEntitiesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], InsuranceEntitiesService);
//# sourceMappingURL=insurance-entities.service.js.map