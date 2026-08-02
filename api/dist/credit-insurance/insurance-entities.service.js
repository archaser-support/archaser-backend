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
    async create(entityType, user, body) {
        if (entityType === "insurance-policies") {
            throw new common_1.BadRequestException({
                error: "Use dedicated policy create flow",
            });
        }
        const accountId = await this.accountId(user);
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const policyId = Number(body.insurance_policy_id);
        if (!Number.isFinite(policyId)) {
            throw new common_1.BadRequestException({
                error: "insurance_policy_id is required",
            });
        }
        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: policyId, account_id: accountId },
            select: { id: true },
        });
        if (!policy) {
            throw new common_1.NotFoundException({ error: "Policy not found" });
        }
        if (entityType === "insurance-policy-countries") {
            const countryId = Number(body.country_id);
            if (!Number.isFinite(countryId)) {
                throw new common_1.BadRequestException({
                    error: "country_id is required",
                });
            }
            const existing = await this.db.insurancePolicyCountry.findFirst({
                where: {
                    insurance_policy_id: policyId,
                    country_id: countryId,
                },
            });
            const data = {
                payment_term_cap: body.payment_term_cap == null
                    ? null
                    : Number(body.payment_term_cap),
                country_mep: body.country_mep == null ? null : Number(body.country_mep),
                reporting_days: body.reporting_days == null
                    ? null
                    : Number(body.reporting_days),
                country_max_limit: body.country_max_limit == null
                    ? null
                    : body.country_max_limit,
                modified_by: userInfo.userId,
            };
            if (existing) {
                const updated = await this.db.insurancePolicyCountry.update({
                    where: { id: existing.id },
                    data: data,
                });
                return (0, serialize_bigint_1.serializeBigInt)(updated);
            }
            const created = await this.db.insurancePolicyCountry.create({
                data: {
                    insurance_policy_id: policyId,
                    country_id: countryId,
                    ...data,
                    created_by: userInfo.userId,
                },
            });
            return (0, serialize_bigint_1.serializeBigInt)(created);
        }
        const customerNumber = String(body.customer_number || "").trim();
        if (!customerNumber) {
            throw new common_1.BadRequestException({
                error: "customer_number is required",
            });
        }
        const existingNamed = await this.db.namedPolicy.findFirst({
            where: {
                insurance_policy_id: policyId,
                customer_number: customerNumber,
            },
        });
        const namedData = {
            max_payment_term: body.max_payment_term == null
                ? null
                : Number(body.max_payment_term),
            customer_mep: body.customer_mep == null ? null : Number(body.customer_mep),
            reporting_days: body.reporting_days == null
                ? null
                : Number(body.reporting_days),
            customer_max_limit: body.customer_max_limit == null
                ? null
                : body.customer_max_limit,
            limit_expiration_date: body.limit_expiration_date
                ? new Date(String(body.limit_expiration_date))
                : null,
            modified_by: userInfo.userId,
        };
        if (existingNamed) {
            const updated = await this.db.namedPolicy.update({
                where: { id: existingNamed.id },
                data: namedData,
            });
            return (0, serialize_bigint_1.serializeBigInt)(updated);
        }
        const created = await this.db.namedPolicy.create({
            data: {
                insurance_policy_id: policyId,
                customer_number: customerNumber,
                ...namedData,
                created_by: userInfo.userId,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(created);
    }
    async remove(entityType, user, id) {
        if (entityType === "insurance-policies") {
            throw new common_1.BadRequestException({
                error: "Policy delete not supported here",
            });
        }
        await this.getById(entityType, user, id);
        const delegate = this.delegate(entityType);
        await delegate.delete({ where: { id } });
        return { success: true };
    }
    async customerPrefill(user, policyId, query) {
        const accountId = await this.accountId(user);
        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: policyId, account_id: accountId },
        });
        if (!policy) {
            throw new common_1.NotFoundException({ error: "Policy not found" });
        }
        const countryId = query.country_id
            ? parseInt(query.country_id, 10)
            : null;
        const customerNumber = query.customer_number?.trim() || null;
        const customerNumberPolicy = query.customer_number_policy?.trim() || null;
        const namedMatchByPolicyCustomerNumberOnly = query.named_match === "policy_customer_number";
        let countryRow = null;
        if (countryId && Number.isFinite(countryId)) {
            countryRow = await this.db.insurancePolicyCountry.findFirst({
                where: {
                    insurance_policy_id: policyId,
                    country_id: countryId,
                },
                select: {
                    payment_term_cap: true,
                    country_mep: true,
                    reporting_days: true,
                },
            });
        }
        const namedLookup = namedMatchByPolicyCustomerNumberOnly && customerNumberPolicy
            ? customerNumberPolicy
            : customerNumber;
        let named = null;
        if (namedLookup) {
            named = await this.db.namedPolicy.findFirst({
                where: {
                    insurance_policy_id: policyId,
                    customer_number: namedLookup,
                },
            });
            if (!named && namedMatchByPolicyCustomerNumberOnly) {
                return { source: "no_named_match" };
            }
        }
        return (0, serialize_bigint_1.serializeBigInt)({
            source: named ? "named_policy" : countryRow ? "country" : "policy",
            limit_type: named ? "Named" : "Discretionary",
            max_payment_term: named?.max_payment_term ??
                countryRow?.payment_term_cap ??
                policy.max_payment_term ??
                null,
            max_allowed_mep: named?.customer_mep ??
                countryRow?.country_mep ??
                policy.max_allowed_mep ??
                null,
            reporting_days: named?.reporting_days ??
                countryRow?.reporting_days ??
                policy.reporting_days ??
                null,
            mep_cutoff_day_of_month: policy.mep_cutoff_day_of_month ?? null,
            mep_substitute_day_of_month: policy.mep_substitute_day_of_month ?? null,
            reporting_cutoff_day_of_month: policy.reporting_cutoff_day_of_month ?? null,
            reporting_substitute_day_of_month: policy.reporting_substitute_day_of_month ?? null,
            payment_term_cutoff_day_of_month: policy.payment_term_cutoff_day_of_month ?? null,
            payment_term_substitute_day_of_month: policy.payment_term_substitute_day_of_month ?? null,
            approved_limit: named?.customer_max_limit ?? null,
            approved_limit_expiration_date: named?.limit_expiration_date ?? null,
            credit_score: null,
            customer_number_policy: named?.customer_number ?? null,
        });
    }
    async bulkReplacePolicy(user, body) {
        const accountId = await this.accountId(user);
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const oldPolicyId = Number(body.oldPolicyId);
        const newPolicyId = Number(body.newPolicyId);
        if (!Number.isFinite(oldPolicyId) || !Number.isFinite(newPolicyId)) {
            throw new common_1.BadRequestException({
                error: "oldPolicyId and newPolicyId are required",
            });
        }
        if (oldPolicyId === newPolicyId) {
            throw new common_1.BadRequestException({
                error: "oldPolicyId and newPolicyId must differ",
            });
        }
        const [oldP, newP] = await Promise.all([
            this.db.insurancePolicy.findFirst({
                where: { id: oldPolicyId, account_id: accountId },
                select: { id: true },
            }),
            this.db.insurancePolicy.findFirst({
                where: { id: newPolicyId, account_id: accountId },
                select: { id: true },
            }),
        ]);
        if (!oldP || !newP) {
            throw new common_1.NotFoundException({ error: "Policy not found" });
        }
        const result = await this.db.customerPolicy.updateMany({
            where: {
                insurance_policy_id: oldPolicyId,
                Customer: { account_id: accountId },
            },
            data: {
                insurance_policy_id: newPolicyId,
                modified_by: userInfo.userId,
            },
        });
        return { updatedCount: result.count };
    }
};
exports.InsuranceEntitiesService = InsuranceEntitiesService;
exports.InsuranceEntitiesService = InsuranceEntitiesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], InsuranceEntitiesService);
//# sourceMappingURL=insurance-entities.service.js.map