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
exports.AccountAdminEntitiesService = exports.ACCOUNT_ADMIN_ENTITY_TYPES = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
exports.ACCOUNT_ADMIN_ENTITY_TYPES = [
    "accounts",
    "users",
    "business-units",
    "bank-accounts",
    "customer-banks",
    "business-unit-banks",
];
const ENTITY_CONFIG = {
    accounts: {
        delegate: "account",
        scopeField: "id",
        listKey: "accounts",
        idType: "number",
        searchFields: ["name"],
    },
    users: {
        delegate: "user",
        scopeField: "account_id",
        listKey: "users",
        idType: "string",
        searchFields: ["name", "email", "username"],
    },
    "business-units": {
        delegate: "businessUnit",
        scopeField: "account_id",
        listKey: "businessUnits",
        idType: "number",
        searchFields: ["name"],
    },
    "bank-accounts": {
        delegate: "accountBankAccounts",
        scopeField: "account_id",
        listKey: "bankAccounts",
        idType: "number",
        searchFields: ["bank_name", "beneficiary_name"],
    },
    "customer-banks": {
        delegate: "customerBanks",
        scopeField: "account_id",
        listKey: "customerBanks",
        idType: "number",
    },
    "business-unit-banks": {
        delegate: "businessUnitBankAccounts",
        scopeField: "account_id",
        listKey: "businessUnitBanks",
        idType: "number",
    },
};
let AccountAdminEntitiesService = class AccountAdminEntitiesService {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    delegate(entityType) {
        const config = ENTITY_CONFIG[entityType];
        return this.db[config.delegate];
    }
    parseId(entityType, raw) {
        const config = ENTITY_CONFIG[entityType];
        if (config.idType === "number") {
            const parsed = parseInt(raw, 10);
            if (Number.isNaN(parsed)) {
                throw new common_1.NotFoundException({ error: "Invalid id" });
            }
            return parsed;
        }
        return raw;
    }
    async scope(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        return { accountId, isAdmin };
    }
    async list(entityType, user, query) {
        if (entityType === "business-units" &&
            query.page == null &&
            query.limit == null) {
            return this.listBusinessUnitsDropdown(user);
        }
        const config = ENTITY_CONFIG[entityType];
        const { accountId, isAdmin } = await this.scope(user);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "25", 10);
        const where = isAdmin && config.scopeField === "id"
            ? {}
            : isAdmin && config.scopeField === "account_id"
                ? {}
                : { [config.scopeField]: accountId };
        if (query.search && config.searchFields?.length) {
            where.OR = config.searchFields.map((field) => ({
                [field]: { contains: query.search, mode: "insensitive" },
            }));
        }
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
        if (entityType === "business-units") {
            return (0, serialize_bigint_1.serializeBigInt)({
                data: rows,
                total: totalRecords,
            });
        }
        if (entityType === "bank-accounts") {
            return (0, serialize_bigint_1.serializeBigInt)({
                data: rows,
                total: totalRecords,
            });
        }
        if (entityType === "customer-banks") {
            return (0, serialize_bigint_1.serializeBigInt)({
                data: rows,
                totalRecords,
                page,
                limit,
            });
        }
        if (entityType === "users") {
            return (0, serialize_bigint_1.serializeBigInt)({
                users: rows,
                total: totalRecords,
                page,
                limit,
            });
        }
        return (0, serialize_bigint_1.serializeBigInt)({
            [config.listKey]: rows,
            totalRecords,
            page,
            limit,
        });
    }
    async listBusinessUnitsDropdown(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        const allActive = await this.db.businessUnit.findMany({
            where: {
                account_id: accountId,
                status: "Active",
            },
            include: { Parent: true },
            orderBy: { name: "asc" },
        });
        const sorted = this.sortBusinessUnitsHierarchically(allActive);
        if (isAdmin) {
            return (0, serialize_bigint_1.serializeBigInt)(sorted);
        }
        const userBuId = userInfo.businessUnitId;
        if (!userBuId) {
            return [];
        }
        const descendantIds = await this.accessScope.getBusinessUnitHierarchy(userBuId);
        const allowed = new Set([userBuId, ...descendantIds]);
        return (0, serialize_bigint_1.serializeBigInt)(sorted.filter((bu) => allowed.has(bu.id)));
    }
    sortBusinessUnitsHierarchically(businessUnits) {
        const idSet = new Set(businessUnits.map((bu) => bu.id));
        const result = [];
        const addWithChildren = (bu) => {
            result.push(bu);
            const children = businessUnits
                .filter((b) => b.parent_id === bu.id)
                .sort((a, b) => a.name.localeCompare(b.name, undefined, {
                sensitivity: "base",
                numeric: true,
            }));
            children.forEach((c) => addWithChildren(c));
        };
        const roots = businessUnits
            .filter((b) => !b.parent_id || !idSet.has(b.parent_id))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, {
            sensitivity: "base",
            numeric: true,
        }));
        roots.forEach((r) => addWithChildren(r));
        return result;
    }
    async getById(entityType, user, id) {
        const { accountId, isAdmin } = await this.scope(user);
        const config = ENTITY_CONFIG[entityType];
        const delegate = this.delegate(entityType);
        const row = await delegate.findUnique({ where: { id } });
        if (!row) {
            throw new common_1.NotFoundException({ error: `${entityType} not found` });
        }
        if (!isAdmin) {
            const scopeValue = config.scopeField === "id" ? row.id : row.account_id;
            if (scopeValue !== accountId) {
                throw new common_1.ForbiddenException({ error: "Access denied" });
            }
        }
        return (0, serialize_bigint_1.serializeBigInt)(row);
    }
    async update(entityType, user, id, body) {
        await this.getById(entityType, user, id);
        const data = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.created_at;
        delete data.created_by;
        const delegate = this.delegate(entityType);
        const updated = await delegate.update({ where: { id }, data });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
    async listCollectionAgents(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const effectiveAccountId = userInfo.viewAsUserAccountId || userInfo.accountId;
        const hasViewUsers = await this.accessScope.hasPermission(effectiveAccountId, effectiveRole, "view_users");
        if (!hasViewUsers) {
            throw new common_1.ForbiddenException({
                error: "Access denied: You do not have permission to view users",
            });
        }
        const isAdmin = this.accessScope.isAdminAccount(effectiveAccountId);
        const loggedInUser = await this.db.user.findUnique({
            where: { id: userInfo.userId },
            select: { business_unit_id: true },
        });
        const loggedInUserBuId = loggedInUser?.business_unit_id ?? null;
        const buFilter = await this.accessScope.getUserBusinessUnitFilter(loggedInUserBuId, isAdmin, false);
        const collectionAgents = await this.db.user.findMany({
            where: {
                account_id: accountId,
                status: "Active",
                deactivated_at: null,
                is_audit_user: false,
                ...buFilter,
            },
            select: {
                id: true,
                name: true,
                username: true,
                email: true,
                first_name: true,
                last_name: true,
                role: true,
                status: true,
                business_unit_id: true,
                BusinessUnit: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: {
                name: "asc",
            },
        });
        const agentsWithNames = collectionAgents.map((agent) => {
            const businessUnit = agent.BusinessUnit;
            return {
                ...agent,
                name: agent.name ||
                    (agent.first_name && agent.last_name
                        ? `${agent.first_name} ${agent.last_name}`.trim()
                        : agent.first_name ||
                            agent.last_name ||
                            agent.email ||
                            `Agent ${agent.id}`),
                businessUnitName: businessUnit?.name || null,
            };
        });
        return (0, serialize_bigint_1.serializeBigInt)(agentsWithNames);
    }
};
exports.AccountAdminEntitiesService = AccountAdminEntitiesService;
exports.AccountAdminEntitiesService = AccountAdminEntitiesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], AccountAdminEntitiesService);
//# sourceMappingURL=account-admin-entities.service.js.map