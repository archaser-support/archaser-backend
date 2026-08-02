"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AccountAdminEntitiesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountAdminEntitiesService = exports.ACCOUNT_ADMIN_ENTITY_TYPES = void 0;
const common_1 = require("@nestjs/common");
const bcrypt = __importStar(require("bcryptjs"));
const crypto_1 = require("crypto");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const system_email_service_1 = require("../email/system-email.service");
exports.ACCOUNT_ADMIN_ENTITY_TYPES = [
    "accounts",
    "users",
    "business-units",
    "bank-accounts",
    "customer-banks",
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
};
let AccountAdminEntitiesService = AccountAdminEntitiesService_1 = class AccountAdminEntitiesService {
    constructor(db, accessScope, systemEmail) {
        this.db = db;
        this.accessScope = accessScope;
        this.systemEmail = systemEmail;
        this.logger = new common_1.Logger(AccountAdminEntitiesService_1.name);
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
        if (query.search &&
            config.searchFields?.length &&
            entityType !== "accounts" &&
            entityType !== "users") {
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
        if (entityType === "accounts") {
            return this.listAccounts(query, where, page, limit);
        }
        if (entityType === "users") {
            return this.listUsers(query, where, page, limit);
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
        return (0, serialize_bigint_1.serializeBigInt)({
            [config.listKey]: rows,
            totalRecords,
            page,
            limit,
        });
    }
    async listAccounts(query, baseWhere, page, limit) {
        const where = { ...baseWhere };
        delete where.OR;
        const status = String(query.status || "").trim();
        if (status === "Active" || status === "Inactive") {
            where.status = status;
        }
        const deletionFilter = String(query.deletionFilter || "active").trim();
        if (deletionFilter === "deleted") {
            where.deleted_at = { not: null };
        }
        else if (deletionFilter !== "all") {
            where.deleted_at = null;
        }
        const searchTerm = String(query.search || query.query || "").trim();
        if (searchTerm) {
            const or = [
                { name: { contains: searchTerm, mode: "insensitive" } },
                {
                    company_number: {
                        contains: searchTerm,
                        mode: "insensitive",
                    },
                },
                {
                    Country: {
                        name: { contains: searchTerm, mode: "insensitive" },
                    },
                },
                {
                    State: {
                        name: { contains: searchTerm, mode: "insensitive" },
                    },
                },
            ];
            if (/^\d+$/.test(searchTerm)) {
                or.push({ id: parseInt(searchTerm, 10) });
            }
            where.OR = or;
        }
        const [rows, totalRecords] = await Promise.all([
            this.db.account.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: this.accountOrderBy(query.sortField, query.sortDirection),
                include: {
                    Country: { select: { id: true, name: true } },
                    State: { select: { id: true, name: true } },
                },
            }),
            this.db.account.count({ where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({
            accounts: rows,
            totalRecords,
            page,
            limit,
        });
    }
    async listUsers(query, baseWhere, page, limit) {
        const where = { ...baseWhere };
        delete where.OR;
        const accountIdRaw = String(query.account_id || "").trim();
        if (accountIdRaw) {
            const parsed = parseInt(accountIdRaw, 10);
            if (!Number.isNaN(parsed)) {
                where.account_id = parsed;
            }
        }
        const status = String(query.status || "").trim();
        if (status === "Active" || status === "Inactive") {
            where.status = status;
        }
        const searchTerm = String(query.search || query.query || "").trim();
        if (searchTerm) {
            where.OR = [
                { name: { contains: searchTerm, mode: "insensitive" } },
                { email: { contains: searchTerm, mode: "insensitive" } },
                { username: { contains: searchTerm, mode: "insensitive" } },
            ];
        }
        const [rows, totalRecords] = await Promise.all([
            this.db.user.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: this.userOrderBy(query.sortField, query.sortDirection),
            }),
            this.db.user.count({ where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({
            users: rows,
            total: totalRecords,
            page,
            limit,
        });
    }
    accountOrderBy(sortField, sortDirection) {
        const dir = sortDirection === "desc" ? "desc" : "asc";
        if (sortField === "id" ||
            sortField === "name" ||
            sortField === "status" ||
            sortField === "company_number") {
            return { [sortField]: dir };
        }
        if (sortField === "country") {
            return { Country: { name: dir } };
        }
        if (sortField === "state") {
            return { State: { name: dir } };
        }
        return { id: "asc" };
    }
    userOrderBy(sortField, sortDirection) {
        const dir = sortDirection === "desc" ? "desc" : "asc";
        if (sortField === "name" ||
            sortField === "email" ||
            sortField === "username" ||
            sortField === "status" ||
            sortField === "role" ||
            sortField === "freeze") {
            return { [sortField]: dir };
        }
        return { name: "asc" };
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
    async createUser(user, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const sessionAccountId = this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const accountIdRaw = body.account_id;
        const accountId = typeof accountIdRaw === "number"
            ? accountIdRaw
            : parseInt(String(accountIdRaw || sessionAccountId), 10);
        if (!Number.isFinite(accountId) || accountId <= 0) {
            throw new common_1.BadRequestException({ error: "Customer id required." });
        }
        if (!isAdmin && accountId !== sessionAccountId) {
            throw new common_1.ForbiddenException({ error: "Access denied" });
        }
        const hasManageUsers = isAdmin ||
            (await this.accessScope.hasPermission(sessionAccountId, effectiveRole, "manage_users"));
        if (!hasManageUsers) {
            throw new common_1.ForbiddenException({
                error: "Access denied: You do not have permission to manage users",
            });
        }
        const email = typeof body.email === "string" ? body.email.trim() : "";
        if (!email) {
            throw new common_1.BadRequestException({
                error: "User email is required.",
            });
        }
        const username = typeof body.username === "string" && body.username.trim()
            ? body.username.trim()
            : email;
        const existingUsername = await this.db.user.findFirst({
            where: { username },
            select: { id: true },
        });
        if (existingUsername) {
            throw new common_1.BadRequestException({
                error: "A user with this username already exists.",
                errorCode: "USERNAME_EXISTS",
            });
        }
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: {
                id: true,
                has_collection: true,
                has_credit_insurance: true,
            },
        });
        if (!account) {
            throw new common_1.BadRequestException({
                error: "Account does not exist.",
            });
        }
        const role = typeof body.role === "string" ? body.role.trim() : "";
        if (!role) {
            throw new common_1.BadRequestException({ error: "Role is required." });
        }
        if (role === "archaser_admin" && accountId !== 10013) {
            throw new common_1.BadRequestException({
                error: "archaser_admin role is only allowed on the admin account",
            });
        }
        const businessUnitId = body.business_unit_id == null || body.business_unit_id === ""
            ? null
            : Number(body.business_unit_id);
        if (businessUnitId != null) {
            if (!Number.isFinite(businessUnitId)) {
                throw new common_1.BadRequestException({
                    error: "Invalid business_unit_id",
                });
            }
            const bu = await this.db.businessUnit.findFirst({
                where: { id: businessUnitId, account_id: accountId },
                select: { id: true },
            });
            if (!bu) {
                throw new common_1.BadRequestException({
                    error: "Business unit must belong to the same account",
                });
            }
        }
        const firstName = typeof body.first_name === "string" ? body.first_name : "";
        const lastName = typeof body.last_name === "string" ? body.last_name : "";
        const generatedPassword = (0, crypto_1.randomBytes)(6).toString("base64url");
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);
        const resetToken = (0, crypto_1.randomBytes)(32).toString("hex");
        const resetTokenExpiry = new Date(Date.now() + 3600000 * 24);
        const language = typeof body.language === "string" && body.language
            ? body.language
            : "English";
        const status = body.status === "Inactive" ? "Inactive" : "Active";
        const timeZone = typeof body.time_zone === "string" && body.time_zone
            ? body.time_zone
            : "Asia/Jerusalem";
        const locale = typeof body.locale === "string" && body.locale
            ? body.locale
            : "en-US";
        const mobile = typeof body.mobile === "string" ? body.mobile : null;
        let created;
        try {
            created = await this.db.user.create({
                data: {
                    id: (0, crypto_1.randomUUID)(),
                    account_id: accountId,
                    email,
                    username,
                    mobile,
                    first_name: firstName || null,
                    last_name: lastName || null,
                    name: `${firstName} ${lastName}`.trim() || email,
                    role: role,
                    language: language,
                    status: status,
                    password: hashedPassword,
                    resetToken,
                    resetTokenExpiry,
                    time_zone: timeZone,
                    locale,
                    created_by: userInfo.userId,
                    modified_by: userInfo.userId,
                    business_unit_id: businessUnitId,
                    sidebar_collapsed: false,
                },
            });
        }
        catch (error) {
            const prismaError = error;
            if (prismaError?.code === "P2002") {
                const target = prismaError.meta?.target;
                if (target?.includes("username")) {
                    throw new common_1.BadRequestException({
                        error: "A user with this username already exists.",
                        errorCode: "USERNAME_EXISTS",
                    });
                }
            }
            throw error;
        }
        const frontendBase = process.env.NEST_AUTH_SUCCESS_REDIRECT ||
            process.env.NEXT_PUBLIC_BASE_URL ||
            process.env.NEXTAUTH_URL ||
            "http://localhost:3000";
        const origin = frontendBase
            .replace(/\/login\/?$/, "")
            .replace(/\/$/, "");
        const resetPasswordUrl = `${origin}/reset-password/${resetToken}`;
        try {
            await this.systemEmail.sendWelcomeUserEmail(email, `${firstName} ${lastName}`.trim() || email, resetPasswordUrl, language === "Hebrew" || language === "he" ? "he" : "en", Boolean(account.has_collection), Boolean(account
                .has_credit_insurance), { accountId, userId: created.id });
        }
        catch (emailError) {
            this.logger.error(`Welcome password email failed for user ${created.id}`, emailError instanceof Error
                ? emailError.stack
                : String(emailError));
        }
        const { password: _password, ...safeUser } = created;
        void _password;
        return (0, serialize_bigint_1.serializeBigInt)(safeUser);
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
    parseNumericId(raw, label) {
        const id = parseInt(raw, 10);
        if (Number.isNaN(id)) {
            throw new common_1.BadRequestException({ error: `Invalid ${label}` });
        }
        return id;
    }
    async listBusinessUnitBanks(user, businessUnitIdRaw) {
        const { accountId } = await this.scope(user);
        const businessUnitId = this.parseNumericId(businessUnitIdRaw, "business unit ID");
        const bu = await this.db.businessUnit.findFirst({
            where: { id: businessUnitId, account_id: accountId },
        });
        if (!bu) {
            throw new common_1.NotFoundException({ error: "Business unit not found" });
        }
        const buBanks = await this.db.businessUnitBankAccounts.findMany({
            where: { business_unit_id: businessUnitId },
            include: {
                AccountBankAccounts: {
                    include: { Country: true },
                },
            },
        });
        const transformed = buBanks.map((b) => ({
            ...b,
            CustomerBankAccount: b.AccountBankAccounts,
        }));
        return (0, serialize_bigint_1.serializeBigInt)(transformed);
    }
    async addBusinessUnitBank(user, businessUnitIdRaw, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const businessUnitId = this.parseNumericId(businessUnitIdRaw, "business unit ID");
        const bankAccountId = this.parseNumericId(String(body.bank_account_id ?? ""), "bank account ID");
        const bu = await this.db.businessUnit.findFirst({
            where: { id: businessUnitId, account_id: accountId },
        });
        if (!bu) {
            throw new common_1.NotFoundException({ error: "Business unit not found" });
        }
        const bankAccount = await this.db.accountBankAccounts.findFirst({
            where: { id: bankAccountId, account_id: accountId },
        });
        if (!bankAccount) {
            throw new common_1.NotFoundException({ error: "Bank account not found" });
        }
        const existing = await this.db.businessUnitBankAccounts.findFirst({
            where: {
                business_unit_id: businessUnitId,
                bank_account_id: bankAccountId,
            },
        });
        if (existing) {
            throw new common_1.BadRequestException({
                error: "Bank account is already assigned to this business unit",
            });
        }
        const created = await this.db.businessUnitBankAccounts.create({
            data: {
                business_unit_id: businessUnitId,
                account_id: accountId,
                bank_account_id: bankAccountId,
                created_by: userInfo.userId,
                modified_by: userInfo.userId,
            },
            include: {
                AccountBankAccounts: {
                    include: { Country: true },
                },
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            ...created,
            CustomerBankAccount: created.AccountBankAccounts,
        });
    }
    async removeBusinessUnitBank(user, businessUnitIdRaw, junctionIdRaw) {
        const { accountId } = await this.scope(user);
        const businessUnitId = this.parseNumericId(businessUnitIdRaw, "business unit ID");
        const junctionId = this.parseNumericId(junctionIdRaw, "junction ID");
        const bu = await this.db.businessUnit.findFirst({
            where: { id: businessUnitId, account_id: accountId },
        });
        if (!bu) {
            throw new common_1.NotFoundException({ error: "Business unit not found" });
        }
        const buBank = await this.db.businessUnitBankAccounts.findFirst({
            where: {
                id: junctionId,
                business_unit_id: businessUnitId,
                account_id: accountId,
            },
        });
        if (!buBank) {
            throw new common_1.NotFoundException({
                error: "Business unit bank assignment not found",
            });
        }
        await this.db.businessUnitBankAccounts.delete({
            where: { id: buBank.id },
        });
        return {
            message: "Bank account removed from business unit successfully",
        };
    }
};
exports.AccountAdminEntitiesService = AccountAdminEntitiesService;
exports.AccountAdminEntitiesService = AccountAdminEntitiesService = AccountAdminEntitiesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService,
        system_email_service_1.SystemEmailService])
], AccountAdminEntitiesService);
//# sourceMappingURL=account-admin-entities.service.js.map