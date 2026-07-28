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
        if (entityType === "business-units") {
            const searchTerm = query.search || query.query || "";
            if (searchTerm) {
                where.OR = [
                    { name: { contains: searchTerm, mode: "insensitive" } },
                    {
                        external_id: {
                            contains: searchTerm,
                            mode: "insensitive",
                        },
                    },
                ];
            }
            const [rows, totalRecords] = await Promise.all([
                this.db.businessUnit.findMany({
                    where,
                    skip: (page - 1) * limit,
                    take: limit,
                    orderBy: this.businessUnitOrderBy(query.sortField, query.sortDirection),
                    include: this.businessUnitListInclude(),
                }),
                this.db.businessUnit.count({ where }),
            ]);
            const sorted = query.sortField === "hierarchical"
                ? this.sortBusinessUnitsHierarchically(rows)
                : rows;
            return (0, serialize_bigint_1.serializeBigInt)({
                data: sorted,
                total: totalRecords,
            });
        }
        if (entityType === "bank-accounts") {
            const searchTerm = query.search || query.query || "";
            if (searchTerm) {
                where.OR = [
                    {
                        bank_name: {
                            contains: searchTerm,
                            mode: "insensitive",
                        },
                    },
                    {
                        account_number: {
                            contains: searchTerm,
                            mode: "insensitive",
                        },
                    },
                    {
                        beneficiary_name: {
                            contains: searchTerm,
                            mode: "insensitive",
                        },
                    },
                ];
            }
            const [rows, totalRecords] = await Promise.all([
                this.db.accountBankAccounts.findMany({
                    where,
                    skip: (page - 1) * limit,
                    take: limit,
                    orderBy: this.bankAccountOrderBy(query.sortField, query.sortDirection),
                    include: this.bankAccountListInclude(true),
                }),
                this.db.accountBankAccounts.count({ where }),
            ]);
            return (0, serialize_bigint_1.serializeBigInt)({
                data: rows,
                total: totalRecords,
            });
        }
        const [rows, totalRecords] = await Promise.all([
            delegate.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { id: "asc" },
            }),
            delegate.count({ where }),
        ]);
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
    businessUnitListInclude() {
        return {
            Parent: true,
            User_BusinessUnit_created_byToUser: {
                select: { id: true, name: true, email: true },
            },
            User_BusinessUnit_modified_byToUser: {
                select: { id: true, name: true, email: true },
            },
        };
    }
    businessUnitOrderBy(sortField, sortDirection) {
        const dir = sortDirection === "desc" ? "desc" : "asc";
        if (sortField === "name" ||
            sortField === "external_id" ||
            sortField === "status" ||
            sortField === "is_primary" ||
            sortField === "created_at" ||
            sortField === "modified_at") {
            return { [sortField]: dir };
        }
        return { name: "asc" };
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
            include: this.businessUnitListInclude(),
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
    async listAccountBusinessUnits(user, accountId, query = {}) {
        const { accountId: sessionAccountId, isAdmin } = await this.scope(user);
        if (!isAdmin && accountId !== sessionAccountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        const searchTerm = query.search || query.query || "";
        const where = {
            account_id: accountId,
        };
        if (searchTerm) {
            where.OR = [
                { name: { contains: searchTerm, mode: "insensitive" } },
                {
                    external_id: {
                        contains: searchTerm,
                        mode: "insensitive",
                    },
                },
            ];
        }
        if (query.page == null && query.limit == null) {
            const all = await this.db.businessUnit.findMany({
                where: { ...where, status: "Active" },
                include: this.businessUnitListInclude(),
                orderBy: { name: "asc" },
            });
            return (0, serialize_bigint_1.serializeBigInt)(this.sortBusinessUnitsHierarchically(all));
        }
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "25", 10);
        const [rows, total] = await Promise.all([
            this.db.businessUnit.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: this.businessUnitOrderBy(query.sortField, query.sortDirection),
                include: this.businessUnitListInclude(),
            }),
            this.db.businessUnit.count({ where }),
        ]);
        const data = query.sortField === "hierarchical"
            ? this.sortBusinessUnitsHierarchically(rows)
            : rows;
        return (0, serialize_bigint_1.serializeBigInt)({ data, total });
    }
    bankAccountListInclude(includeCountry = true) {
        return {
            ...(includeCountry ? { Country: true, State: true } : {}),
        };
    }
    bankAccountOrderBy(sortField, sortDirection) {
        const dir = sortDirection === "desc" ? "desc" : "asc";
        if (sortField === "bank_name" ||
            sortField === "account_number" ||
            sortField === "beneficiary_name" ||
            sortField === "status" ||
            sortField === "primary" ||
            sortField === "created_at" ||
            sortField === "modified_at" ||
            sortField === "city") {
            return { [sortField]: dir };
        }
        return { bank_name: "asc" };
    }
    assertAccountAccess(isAdmin, sessionAccountId, accountId) {
        if (!isAdmin && accountId !== sessionAccountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
    }
    async listAccountBankAccounts(user, accountId, query = {}) {
        const { accountId: sessionAccountId, isAdmin } = await this.scope(user);
        this.assertAccountAccess(isAdmin, sessionAccountId, accountId);
        const searchTerm = query.search || query.query || "";
        const includeCountry = !query.include || query.include.includes("Country");
        const where = {
            account_id: accountId,
        };
        if (searchTerm) {
            where.OR = [
                { bank_name: { contains: searchTerm, mode: "insensitive" } },
                {
                    account_number: {
                        contains: searchTerm,
                        mode: "insensitive",
                    },
                },
                {
                    beneficiary_name: {
                        contains: searchTerm,
                        mode: "insensitive",
                    },
                },
            ];
        }
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "25", 10);
        const [rows, total] = await Promise.all([
            this.db.accountBankAccounts.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: this.bankAccountOrderBy(query.sortField, query.sortDirection),
                include: this.bankAccountListInclude(includeCountry),
            }),
            this.db.accountBankAccounts.count({ where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({ data: rows, total });
    }
    async createAccountBankAccount(user, accountId, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const sessionAccountId = this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        this.assertAccountAccess(isAdmin, sessionAccountId, accountId);
        if (!body.bank_name || typeof body.bank_name !== "string") {
            throw new common_1.BadRequestException({ error: "Bank name is required" });
        }
        if (!body.account_number || typeof body.account_number !== "string") {
            throw new common_1.BadRequestException({
                error: "Account number is required",
            });
        }
        const isPrimary = body.primary === true;
        if (isPrimary) {
            await this.db.accountBankAccounts.updateMany({
                where: { account_id: accountId, primary: true },
                data: { primary: false },
            });
        }
        const created = await this.db.accountBankAccounts.create({
            data: {
                account_id: accountId,
                bank_name: body.bank_name,
                account_number: body.account_number,
                beneficiary_name: typeof body.beneficiary_name === "string"
                    ? body.beneficiary_name
                    : null,
                branch_number: typeof body.branch_number === "string"
                    ? body.branch_number
                    : null,
                branch_name: typeof body.branch_name === "string"
                    ? body.branch_name
                    : null,
                swift: typeof body.swift === "string" ? body.swift : null,
                iban: typeof body.iban === "string" ? body.iban : null,
                comments: typeof body.comments === "string" ? body.comments : null,
                address_line1: typeof body.address_line1 === "string"
                    ? body.address_line1
                    : null,
                address_line2: typeof body.address_line2 === "string"
                    ? body.address_line2
                    : null,
                city: typeof body.city === "string" ? body.city : null,
                postal_code: typeof body.postal_code === "string"
                    ? body.postal_code
                    : null,
                country_id: body.country_id == null || body.country_id === ""
                    ? null
                    : Number(body.country_id),
                state_id: body.state_id == null || body.state_id === ""
                    ? null
                    : Number(body.state_id),
                status: body.status === false ? false : true,
                primary: isPrimary,
                created_by: userInfo.userId,
                modified_by: userInfo.userId,
            },
            include: this.bankAccountListInclude(true),
        });
        return (0, serialize_bigint_1.serializeBigInt)(created);
    }
    async updateAccountBankAccount(user, accountId, id, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const sessionAccountId = this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        this.assertAccountAccess(isAdmin, sessionAccountId, accountId);
        const existing = await this.db.accountBankAccounts.findFirst({
            where: { id, account_id: accountId },
        });
        if (!existing) {
            throw new common_1.NotFoundException({ error: "Bank account not found" });
        }
        if (body.primary === true) {
            await this.db.accountBankAccounts.updateMany({
                where: {
                    account_id: accountId,
                    primary: true,
                    NOT: { id },
                },
                data: { primary: false },
            });
        }
        const data = {
            modified_by: userInfo.userId,
            modified_at: new Date(),
        };
        const scalarKeys = [
            "bank_name",
            "account_number",
            "beneficiary_name",
            "branch_number",
            "branch_name",
            "swift",
            "iban",
            "comments",
            "address_line1",
            "address_line2",
            "city",
            "postal_code",
        ];
        for (const key of scalarKeys) {
            if (body[key] !== undefined) {
                data[key] =
                    typeof body[key] === "string" ? body[key] || null : body[key];
            }
        }
        if (body.status !== undefined) {
            data.status = body.status === false ? false : true;
        }
        if (body.primary !== undefined) {
            data.primary = body.primary === true;
        }
        if (body.country_id !== undefined) {
            data.country_id =
                body.country_id == null || body.country_id === ""
                    ? null
                    : Number(body.country_id);
        }
        if (body.state_id !== undefined) {
            data.state_id =
                body.state_id == null || body.state_id === ""
                    ? null
                    : Number(body.state_id);
        }
        const updated = await this.db.accountBankAccounts.update({
            where: { id },
            data,
            include: this.bankAccountListInclude(true),
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
    async deleteAccountBankAccount(user, accountId, id) {
        const { accountId: sessionAccountId, isAdmin } = await this.scope(user);
        this.assertAccountAccess(isAdmin, sessionAccountId, accountId);
        const existing = await this.db.accountBankAccounts.findFirst({
            where: { id, account_id: accountId },
            select: { id: true, primary: true },
        });
        if (!existing) {
            throw new common_1.NotFoundException({ error: "Bank account not found" });
        }
        if (existing.primary) {
            throw new common_1.BadRequestException({
                error: "Cannot delete primary bank account",
            });
        }
        const linked = await this.db.customerBanks.count({
            where: { customer_bank_account_id: id },
        });
        if (linked > 0) {
            throw new common_1.BadRequestException({
                error: "Cannot delete bank account assigned to customers",
                count: linked,
            });
        }
        await this.db.accountBankAccounts.delete({ where: { id } });
        return { success: true };
    }
    async createBusinessUnit(user, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const sessionAccountId = this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        const accountId = typeof body.account_id === "number"
            ? body.account_id
            : parseInt(String(body.account_id || sessionAccountId), 10);
        if (!isAdmin && accountId !== sessionAccountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        if (!body.name || typeof body.name !== "string") {
            throw new common_1.BadRequestException({ error: "Name is required" });
        }
        const parentId = body.parent_id == null || body.parent_id === ""
            ? null
            : Number(body.parent_id);
        if (parentId != null) {
            const parent = await this.db.businessUnit.findFirst({
                where: { id: parentId, account_id: accountId },
                select: { id: true },
            });
            if (!parent) {
                throw new common_1.BadRequestException({
                    error: "Parent business unit must belong to the same account",
                });
            }
        }
        const created = await this.db.businessUnit.create({
            data: {
                name: body.name,
                account_id: accountId,
                parent_id: parentId,
                external_id: typeof body.external_id === "string"
                    ? body.external_id || null
                    : null,
                status: body.status === "Inactive" ? "Inactive" : "Active",
                created_by: userInfo.userId,
                modified_by: userInfo.userId,
            },
            include: this.businessUnitListInclude(),
        });
        return (0, serialize_bigint_1.serializeBigInt)(created);
    }
    async updateBusinessUnitStatus(user, id, status) {
        const existing = await this.getById("business-units", user, id);
        if (existing.is_primary && status === "Inactive") {
            throw new common_1.BadRequestException({
                error: "Cannot deactivate primary business unit",
            });
        }
        if (status === "Inactive") {
            const activeUsers = await this.db.user.count({
                where: {
                    business_unit_id: id,
                    status: "Active",
                    deactivated_at: null,
                },
            });
            if (activeUsers > 0) {
                throw new common_1.BadRequestException({
                    error: `Cannot disable business unit. This business unit has ${activeUsers} active user(s) assigned.`,
                    count: activeUsers,
                });
            }
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const updated = await this.db.businessUnit.update({
            where: { id },
            data: {
                status,
                modified_by: userInfo.userId,
                modified_at: new Date(),
            },
            include: this.businessUnitListInclude(),
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
    async deleteBusinessUnit(user, id, reassignToBusinessUnitId) {
        const existing = (await this.getById("business-units", user, id));
        if (existing.is_primary) {
            throw new common_1.BadRequestException({
                error: "Cannot delete primary business unit",
            });
        }
        const childCount = await this.db.businessUnit.count({
            where: { parent_id: id },
        });
        if (childCount > 0) {
            throw new common_1.BadRequestException({
                error: "Cannot delete business unit with child units",
            });
        }
        if (reassignToBusinessUnitId) {
            const target = await this.db.businessUnit.findFirst({
                where: {
                    id: reassignToBusinessUnitId,
                    account_id: existing.account_id,
                },
                select: { id: true },
            });
            if (!target) {
                throw new common_1.BadRequestException({
                    error: "Reassign target business unit not found",
                });
            }
            await this.db.user.updateMany({
                where: { business_unit_id: id },
                data: { business_unit_id: reassignToBusinessUnitId },
            });
            await this.db.customer.updateMany({
                where: { business_unit_id: id },
                data: { business_unit_id: reassignToBusinessUnitId },
            });
        }
        else {
            const assignedUsers = await this.db.user.count({
                where: { business_unit_id: id },
            });
            if (assignedUsers > 0) {
                throw new common_1.BadRequestException({
                    error: "Business unit has users assigned; reassign them first",
                    count: assignedUsers,
                });
            }
        }
        await this.db.businessUnit.delete({ where: { id } });
        return { success: true };
    }
    async getById(entityType, user, id) {
        const { accountId, isAdmin } = await this.scope(user);
        const config = ENTITY_CONFIG[entityType];
        const delegate = this.delegate(entityType);
        const row = entityType === "business-units"
            ? await this.db.businessUnit.findUnique({
                where: { id: id },
                include: this.businessUnitListInclude(),
            })
            : await delegate.findUnique({ where: { id } });
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
        if (entityType === "business-units") {
            const userInfo = await this.accessScope.resolveUserInfo(user);
            const data = {
                modified_by: userInfo.userId,
                modified_at: new Date(),
            };
            if (typeof body.name === "string")
                data.name = body.name;
            if (body.external_id !== undefined) {
                data.external_id =
                    typeof body.external_id === "string"
                        ? body.external_id || null
                        : null;
            }
            if (body.status === "Active" || body.status === "Inactive") {
                data.status = body.status;
            }
            if (body.parent_id !== undefined) {
                data.parent_id =
                    body.parent_id == null || body.parent_id === ""
                        ? null
                        : Number(body.parent_id);
            }
            const updated = await this.db.businessUnit.update({
                where: { id: id },
                data,
                include: this.businessUnitListInclude(),
            });
            return (0, serialize_bigint_1.serializeBigInt)(updated);
        }
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