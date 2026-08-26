import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "crypto";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import { SystemEmailService } from "../email/system-email.service";

export const ACCOUNT_ADMIN_ENTITY_TYPES = [
    "accounts",
    "users",
    "business-units",
    "bank-accounts",
    "customer-banks",
] as const;

export type AccountAdminEntityType =
    (typeof ACCOUNT_ADMIN_ENTITY_TYPES)[number];

type EntityConfig = {
    /** DatabaseService delegate name (Prisma model accessor). */
    delegate:
        | "account"
        | "user"
        | "businessUnit"
        | "accountBankAccounts"
        | "customerBanks";
    /** How the row is scoped to the caller's account. */
    scopeField: "id" | "account_id";
    listKey: string;
    idType: "number" | "string";
    searchFields?: string[];
};

const ENTITY_CONFIG: Record<AccountAdminEntityType, EntityConfig> = {
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

export type AccountAdminListQuery = {
    page?: string;
    limit?: string;
    search?: string;
    query?: string;
    sortField?: string;
    sortDirection?: string;
    include?: string;
    status?: string;
    deletionFilter?: string;
    account_id?: string;
    customer_id?: string;
};

@Injectable()
export class AccountAdminEntitiesService {
    private readonly logger = new Logger(AccountAdminEntitiesService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService,
        private readonly systemEmail: SystemEmailService
    ) {}

    private delegate(entityType: AccountAdminEntityType) {
        const config = ENTITY_CONFIG[entityType];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.db as any)[config.delegate];
    }

    parseId(entityType: AccountAdminEntityType, raw: string): number | string {
        const config = ENTITY_CONFIG[entityType];
        if (config.idType === "number") {
            const parsed = parseInt(raw, 10);
            if (Number.isNaN(parsed)) {
                throw new NotFoundException({ error: "Invalid id" });
            }
            return parsed;
        }
        return raw;
    }

    private async scope(user: JwtPayload) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        return { accountId, isAdmin };
    }

    async list(
        entityType: AccountAdminEntityType,
        user: JwtPayload,
        query: AccountAdminListQuery
    ) {
        if (
            entityType === "business-units" &&
            query.page == null &&
            query.limit == null
        ) {
            return this.listBusinessUnitsDropdown(user);
        }

        const config = ENTITY_CONFIG[entityType];
        const { accountId, isAdmin } = await this.scope(user);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "25", 10);

        // Archaser admins may list accounts/users across tenants. Other entity
        // types stay account-scoped (optional `account_id` query for admins).
        let where: Record<string, unknown> = {};
        if (
            isAdmin &&
            (entityType === "accounts" || entityType === "users")
        ) {
            where = {};
        } else {
            let scopeAccountId = accountId;
            if (isAdmin && query.account_id) {
                const parsed = parseInt(query.account_id, 10);
                if (!Number.isNaN(parsed)) {
                    scopeAccountId = parsed;
                }
            }
            where = { [config.scopeField]: scopeAccountId };
        }

        if (entityType === "customer-banks" && query.customer_id) {
            const customerId = parseInt(query.customer_id, 10);
            if (!Number.isNaN(customerId)) {
                where.customer_id = customerId;
            }
        }

        // Accounts/users build their own search OR (id, relations, etc.).
        if (
            query.search &&
            config.searchFields?.length &&
            entityType !== "accounts" &&
            entityType !== "users"
        ) {
            (where.OR as unknown) = config.searchFields.map((field) => ({
                [field]: { contains: query.search, mode: "insensitive" },
            }));
        }

        const delegate = this.delegate(entityType);

        // Settings Business Units grid needs Parent + audit users.
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
                    orderBy: this.businessUnitOrderBy(
                        query.sortField,
                        query.sortDirection
                    ),
                    include: this.businessUnitListInclude(),
                }),
                this.db.businessUnit.count({ where }),
            ]);
            const sorted =
                query.sortField === "hierarchical"
                    ? this.sortBusinessUnitsHierarchically(rows)
                    : rows;
            return serializeBigInt({
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
                    orderBy: this.bankAccountOrderBy(
                        query.sortField,
                        query.sortDirection
                    ),
                    include: this.bankAccountListInclude(true),
                }),
                this.db.accountBankAccounts.count({ where }),
            ]);
            return serializeBigInt({
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

        // Legacy pagination shapes for settings UIs.
        if (entityType === "customer-banks") {
            return serializeBigInt({
                data: rows,
                totalRecords,
                page,
                limit,
            });
        }

        return serializeBigInt({
            [config.listKey]: rows,
            totalRecords,
            page,
            limit,
        });
    }

    private async listAccounts(
        query: AccountAdminListQuery,
        baseWhere: Record<string, unknown>,
        page: number,
        limit: number
    ) {
        const where: Record<string, unknown> = { ...baseWhere };
        delete where.OR;

        const status = String(query.status || "").trim();
        if (status === "Active" || status === "Inactive") {
            where.status = status;
        }

        const deletionFilter = String(query.deletionFilter || "active").trim();
        if (deletionFilter === "deleted") {
            where.deleted_at = { not: null };
        } else if (deletionFilter !== "all") {
            // Default "active" — hide soft-deleted accounts.
            where.deleted_at = null;
        }

        const searchTerm = String(query.search || query.query || "").trim();
        if (searchTerm) {
            const or: Record<string, unknown>[] = [
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
                orderBy: this.accountOrderBy(
                    query.sortField,
                    query.sortDirection
                ),
                include: {
                    Country: { select: { id: true, name: true } },
                    State: { select: { id: true, name: true } },
                },
            }),
            this.db.account.count({ where }),
        ]);

        return serializeBigInt({
            accounts: rows,
            totalRecords,
            page,
            limit,
        });
    }

    private async listUsers(
        query: AccountAdminListQuery,
        baseWhere: Record<string, unknown>,
        page: number,
        limit: number
    ) {
        const where: Record<string, unknown> = { ...baseWhere };
        delete where.OR;

        // Always honor account_id when the UI sends it (Account Users tab).
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
                orderBy: this.userOrderBy(
                    query.sortField,
                    query.sortDirection
                ),
            }),
            this.db.user.count({ where }),
        ]);

        return serializeBigInt({
            users: rows,
            total: totalRecords,
            page,
            limit,
        });
    }

    private accountOrderBy(
        sortField?: string,
        sortDirection?: string
    ):
        | Record<string, "asc" | "desc">
        | Record<string, Record<string, "asc" | "desc">> {
        const dir = sortDirection === "desc" ? "desc" : "asc";
        if (
            sortField === "id" ||
            sortField === "name" ||
            sortField === "status" ||
            sortField === "company_number"
        ) {
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

    private userOrderBy(
        sortField?: string,
        sortDirection?: string
    ): Record<string, "asc" | "desc"> {
        const dir = sortDirection === "desc" ? "desc" : "asc";
        if (
            sortField === "name" ||
            sortField === "email" ||
            sortField === "username" ||
            sortField === "status" ||
            sortField === "role" ||
            sortField === "freeze"
        ) {
            return { [sortField]: dir };
        }
        return { name: "asc" };
    }

    private businessUnitListInclude() {
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

    private businessUnitOrderBy(
        sortField?: string,
        sortDirection?: string
    ): Record<string, "asc" | "desc"> {
        const dir = sortDirection === "desc" ? "desc" : "asc";
        if (
            sortField === "name" ||
            sortField === "external_id" ||
            sortField === "status" ||
            sortField === "is_primary" ||
            sortField === "created_at" ||
            sortField === "modified_at"
        ) {
            return { [sortField]: dir };
        }
        return { name: "asc" };
    }

    /** Dropdown list (no page/limit): plain array matching legacy handler. */
    private async listBusinessUnitsDropdown(user: JwtPayload) {
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
            return serializeBigInt(sorted);
        }

        const userBuId = userInfo.businessUnitId;
        if (!userBuId) {
            return [];
        }

        const descendantIds =
            await this.accessScope.getBusinessUnitHierarchy(userBuId);
        const allowed = new Set([userBuId, ...descendantIds]);
        return serializeBigInt(sorted.filter((bu) => allowed.has(bu.id)));
    }

    private sortBusinessUnitsHierarchically<
        T extends { id: number; parent_id: number | null; name: string },
    >(businessUnits: T[]): T[] {
        const idSet = new Set(businessUnits.map((bu) => bu.id));
        const result: T[] = [];

        const addWithChildren = (bu: T) => {
            result.push(bu);
            const children = businessUnits
                .filter((b) => b.parent_id === bu.id)
                .sort((a, b) =>
                    a.name.localeCompare(b.name, undefined, {
                        sensitivity: "base",
                        numeric: true,
                    })
                );
            children.forEach((c) => addWithChildren(c));
        };

        const roots = businessUnits
            .filter((b) => !b.parent_id || !idSet.has(b.parent_id))
            .sort((a, b) =>
                a.name.localeCompare(b.name, undefined, {
                    sensitivity: "base",
                    numeric: true,
                })
            );
        roots.forEach((r) => addWithChildren(r));
        return result;
    }

    /**
     * Nested settings/UI route:
     * GET /api/entities/accounts/:accountId/business-units
     */
    async listAccountBusinessUnits(
        user: JwtPayload,
        accountId: number,
        query: AccountAdminListQuery = {}
    ) {
        const { accountId: sessionAccountId, isAdmin } = await this.scope(user);
        if (!isAdmin && accountId !== sessionAccountId) {
            throw new ForbiddenException({ error: "Access denied" });
        }

        const searchTerm = query.search || query.query || "";
        const where: Record<string, unknown> = {
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

        // Dropdown / parent-picker: no pagination → full array (legacy shape).
        if (query.page == null && query.limit == null) {
            const all = await this.db.businessUnit.findMany({
                where: { ...where, status: "Active" },
                include: this.businessUnitListInclude(),
                orderBy: { name: "asc" },
            });
            return serializeBigInt(this.sortBusinessUnitsHierarchically(all));
        }

        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "25", 10);
        const [rows, total] = await Promise.all([
            this.db.businessUnit.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: this.businessUnitOrderBy(
                    query.sortField,
                    query.sortDirection
                ),
                include: this.businessUnitListInclude(),
            }),
            this.db.businessUnit.count({ where }),
        ]);
        const data =
            query.sortField === "hierarchical"
                ? this.sortBusinessUnitsHierarchically(rows)
                : rows;
        return serializeBigInt({ data, total });
    }

    private bankAccountListInclude(includeCountry = true) {
        return {
            ...(includeCountry ? { Country: true, State: true } : {}),
        };
    }

    private bankAccountOrderBy(
        sortField?: string,
        sortDirection?: string
    ): Record<string, "asc" | "desc"> {
        const dir = sortDirection === "desc" ? "desc" : "asc";
        if (
            sortField === "bank_name" ||
            sortField === "account_number" ||
            sortField === "beneficiary_name" ||
            sortField === "status" ||
            sortField === "primary" ||
            sortField === "created_at" ||
            sortField === "modified_at" ||
            sortField === "city"
        ) {
            return { [sortField]: dir };
        }
        return { bank_name: "asc" };
    }

    private assertAccountAccess(
        isAdmin: boolean,
        sessionAccountId: number,
        accountId: number
    ) {
        if (!isAdmin && accountId !== sessionAccountId) {
            throw new ForbiddenException({ error: "Access denied" });
        }
    }

    /**
     * Nested settings route:
     * GET /api/entities/accounts/:accountId/bank-accounts
     */
    async listAccountBankAccounts(
        user: JwtPayload,
        accountId: number,
        query: AccountAdminListQuery = {}
    ) {
        const { accountId: sessionAccountId, isAdmin } = await this.scope(user);
        this.assertAccountAccess(isAdmin, sessionAccountId, accountId);

        const searchTerm = query.search || query.query || "";
        const includeCountry =
            !query.include || query.include.includes("Country");
        const where: Record<string, unknown> = {
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
                orderBy: this.bankAccountOrderBy(
                    query.sortField,
                    query.sortDirection
                ),
                include: this.bankAccountListInclude(includeCountry),
            }),
            this.db.accountBankAccounts.count({ where }),
        ]);
        return serializeBigInt({ data: rows, total });
    }

    async createAccountBankAccount(
        user: JwtPayload,
        accountId: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const sessionAccountId =
            this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        this.assertAccountAccess(isAdmin, sessionAccountId, accountId);

        if (!body.bank_name || typeof body.bank_name !== "string") {
            throw new BadRequestException({ error: "Bank name is required" });
        }
        if (!body.account_number || typeof body.account_number !== "string") {
            throw new BadRequestException({
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
                beneficiary_name:
                    typeof body.beneficiary_name === "string"
                        ? body.beneficiary_name
                        : null,
                branch_number:
                    typeof body.branch_number === "string"
                        ? body.branch_number
                        : null,
                branch_name:
                    typeof body.branch_name === "string"
                        ? body.branch_name
                        : null,
                swift: typeof body.swift === "string" ? body.swift : null,
                iban: typeof body.iban === "string" ? body.iban : null,
                comments:
                    typeof body.comments === "string" ? body.comments : null,
                address_line1:
                    typeof body.address_line1 === "string"
                        ? body.address_line1
                        : null,
                address_line2:
                    typeof body.address_line2 === "string"
                        ? body.address_line2
                        : null,
                city: typeof body.city === "string" ? body.city : null,
                postal_code:
                    typeof body.postal_code === "string"
                        ? body.postal_code
                        : null,
                country_id:
                    body.country_id == null || body.country_id === ""
                        ? null
                        : Number(body.country_id),
                state_id:
                    body.state_id == null || body.state_id === ""
                        ? null
                        : Number(body.state_id),
                status: body.status === false ? false : true,
                primary: isPrimary,
                created_by: userInfo.userId,
                modified_by: userInfo.userId,
            },
            include: this.bankAccountListInclude(true),
        });
        return serializeBigInt(created);
    }

    async updateAccountBankAccount(
        user: JwtPayload,
        accountId: number,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const sessionAccountId =
            this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        this.assertAccountAccess(isAdmin, sessionAccountId, accountId);

        const existing = await this.db.accountBankAccounts.findFirst({
            where: { id, account_id: accountId },
        });
        if (!existing) {
            throw new NotFoundException({ error: "Bank account not found" });
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

        const data: Record<string, unknown> = {
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
        ] as const;
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
        return serializeBigInt(updated);
    }

    async deleteAccountBankAccount(
        user: JwtPayload,
        accountId: number,
        id: number
    ) {
        const { accountId: sessionAccountId, isAdmin } = await this.scope(user);
        this.assertAccountAccess(isAdmin, sessionAccountId, accountId);

        const existing = await this.db.accountBankAccounts.findFirst({
            where: { id, account_id: accountId },
            select: { id: true, primary: true },
        });
        if (!existing) {
            throw new NotFoundException({ error: "Bank account not found" });
        }
        if (existing.primary) {
            throw new BadRequestException({
                error: "Cannot delete primary bank account",
            });
        }
        const linked = await this.db.customerBanks.count({
            where: { customer_bank_account_id: id },
        });
        if (linked > 0) {
            throw new BadRequestException({
                error: "Cannot delete bank account assigned to customers",
                count: linked,
            });
        }
        await this.db.accountBankAccounts.delete({ where: { id } });
        return { success: true };
    }

    /**
     * Create a user with a generated password + password-setup (welcome) email.
     * Parity with the pre-Nest UserService.createUser flow.
     */
    async createUser(user: JwtPayload, body: Record<string, unknown>) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const sessionAccountId =
            this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;

        const accountIdRaw = body.account_id;
        const accountId =
            typeof accountIdRaw === "number"
                ? accountIdRaw
                : parseInt(String(accountIdRaw || sessionAccountId), 10);
        if (!Number.isFinite(accountId) || accountId <= 0) {
            throw new BadRequestException({ error: "Customer id required." });
        }
        if (!isAdmin && accountId !== sessionAccountId) {
            throw new ForbiddenException({ error: "Access denied" });
        }

        const hasManageUsers =
            isAdmin ||
            (await this.accessScope.hasPermission(
                sessionAccountId,
                effectiveRole,
                "manage_users"
            ));
        if (!hasManageUsers) {
            throw new ForbiddenException({
                error: "Access denied: You do not have permission to manage users",
            });
        }

        const email =
            typeof body.email === "string" ? body.email.trim() : "";
        if (!email) {
            throw new BadRequestException({
                error: "User email is required.",
            });
        }

        const username =
            typeof body.username === "string" && body.username.trim()
                ? body.username.trim()
                : email;
        const existingUsername = await this.db.user.findFirst({
            where: { username },
            select: { id: true },
        });
        if (existingUsername) {
            throw new BadRequestException({
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
            throw new BadRequestException({
                error: "Account does not exist.",
            });
        }

        const role =
            typeof body.role === "string" ? body.role.trim() : "";
        if (!role) {
            throw new BadRequestException({ error: "Role is required." });
        }
        if (role === "archaser_admin" && accountId !== 10013) {
            throw new BadRequestException({
                error: "archaser_admin role is only allowed on the admin account",
            });
        }

        const businessUnitId =
            body.business_unit_id == null || body.business_unit_id === ""
                ? null
                : Number(body.business_unit_id);
        if (businessUnitId != null) {
            if (!Number.isFinite(businessUnitId)) {
                throw new BadRequestException({
                    error: "Invalid business_unit_id",
                });
            }
            const bu = await this.db.businessUnit.findFirst({
                where: { id: businessUnitId, account_id: accountId },
                select: { id: true },
            });
            if (!bu) {
                throw new BadRequestException({
                    error: "Business unit must belong to the same account",
                });
            }
        }

        const firstName =
            typeof body.first_name === "string" ? body.first_name : "";
        const lastName =
            typeof body.last_name === "string" ? body.last_name : "";
        const generatedPassword = randomBytes(6).toString("base64url");
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);
        const resetToken = randomBytes(32).toString("hex");
        const resetTokenExpiry = new Date(Date.now() + 3600000 * 24); // 24h

        const language =
            typeof body.language === "string" && body.language
                ? body.language
                : "English";
        const status =
            body.status === "Inactive" ? "Inactive" : "Active";
        const timeZone =
            typeof body.time_zone === "string" && body.time_zone
                ? body.time_zone
                : "Asia/Jerusalem";
        const locale =
            typeof body.locale === "string" && body.locale
                ? body.locale
                : "en-US";
        const mobile =
            typeof body.mobile === "string" ? body.mobile : null;

        let created;
        try {
            created = await this.db.user.create({
                data: {
                    id: randomUUID(),
                    account_id: accountId,
                    email,
                    username,
                    mobile,
                    first_name: firstName || null,
                    last_name: lastName || null,
                    name: `${firstName} ${lastName}`.trim() || email,
                    role: role as never,
                    language: language as never,
                    status: status as never,
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
        } catch (error: unknown) {
            const prismaError = error as {
                code?: string;
                meta?: { target?: string[] };
            };
            if (prismaError?.code === "P2002") {
                const target = prismaError.meta?.target;
                if (target?.includes("username")) {
                    throw new BadRequestException({
                        error: "A user with this username already exists.",
                        errorCode: "USERNAME_EXISTS",
                    });
                }
            }
            throw error;
        }

        const frontendBase =
            process.env.NEST_AUTH_SUCCESS_REDIRECT ||
            process.env.NEXT_PUBLIC_BASE_URL ||
            process.env.NEXTAUTH_URL ||
            "http://localhost:3000";
        const origin = frontendBase
            .replace(/\/login\/?$/, "")
            .replace(/\/$/, "");
        const resetPasswordUrl = `${origin}/reset-password/${resetToken}`;

        try {
            await this.systemEmail.sendWelcomeUserEmail(
                email,
                `${firstName} ${lastName}`.trim() || email,
                resetPasswordUrl,
                language === "Hebrew" || language === "he" ? "he" : "en",
                Boolean(
                    (account as { has_collection?: boolean }).has_collection
                ),
                Boolean(
                    (account as { has_credit_insurance?: boolean })
                        .has_credit_insurance
                ),
                { accountId, userId: created.id }
            );
        } catch (emailError) {
            this.logger.error(
                `Welcome password email failed for user ${created.id}`,
                emailError instanceof Error
                    ? emailError.stack
                    : String(emailError)
            );
            // User is already created; do not fail the request.
        }

        const { password: _password, ...safeUser } = created;
        void _password;
        return serializeBigInt(safeUser);
    }

    async createBusinessUnit(user: JwtPayload, body: Record<string, unknown>) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const sessionAccountId =
            this.accessScope.getEffectiveAccountId(userInfo);
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        const accountId =
            typeof body.account_id === "number"
                ? body.account_id
                : parseInt(String(body.account_id || sessionAccountId), 10);
        if (!isAdmin && accountId !== sessionAccountId) {
            throw new ForbiddenException({ error: "Access denied" });
        }
        if (!body.name || typeof body.name !== "string") {
            throw new BadRequestException({ error: "Name is required" });
        }
        const parentId =
            body.parent_id == null || body.parent_id === ""
                ? null
                : Number(body.parent_id);
        if (parentId != null) {
            const parent = await this.db.businessUnit.findFirst({
                where: { id: parentId, account_id: accountId },
                select: { id: true },
            });
            if (!parent) {
                throw new BadRequestException({
                    error: "Parent business unit must belong to the same account",
                });
            }
        }
        const created = await this.db.businessUnit.create({
            data: {
                name: body.name,
                account_id: accountId,
                parent_id: parentId,
                external_id:
                    typeof body.external_id === "string"
                        ? body.external_id || null
                        : null,
                status:
                    body.status === "Inactive" ? "Inactive" : ("Active" as const),
                created_by: userInfo.userId,
                modified_by: userInfo.userId,
            },
            include: this.businessUnitListInclude(),
        });
        return serializeBigInt(created);
    }

    async updateBusinessUnitStatus(
        user: JwtPayload,
        id: number,
        status: "Active" | "Inactive"
    ) {
        const existing = await this.getById("business-units", user, id);
        if (existing.is_primary && status === "Inactive") {
            throw new BadRequestException({
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
                throw new BadRequestException({
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
        return serializeBigInt(updated);
    }

    async deleteBusinessUnit(
        user: JwtPayload,
        id: number,
        reassignToBusinessUnitId?: number | null
    ) {
        const existing = (await this.getById(
            "business-units",
            user,
            id
        )) as { is_primary?: boolean; account_id: number };
        if (existing.is_primary) {
            throw new BadRequestException({
                error: "Cannot delete primary business unit",
            });
        }
        const childCount = await this.db.businessUnit.count({
            where: { parent_id: id },
        });
        if (childCount > 0) {
            throw new BadRequestException({
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
                throw new BadRequestException({
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
        } else {
            const assignedUsers = await this.db.user.count({
                where: { business_unit_id: id },
            });
            if (assignedUsers > 0) {
                throw new BadRequestException({
                    error: "Business unit has users assigned; reassign them first",
                    count: assignedUsers,
                });
            }
        }
        await this.db.businessUnit.delete({ where: { id } });
        return { success: true };
    }

    async getById(
        entityType: AccountAdminEntityType,
        user: JwtPayload,
        id: number | string
    ) {
        const { accountId, isAdmin } = await this.scope(user);
        const config = ENTITY_CONFIG[entityType];
        const delegate = this.delegate(entityType);

        const row =
            entityType === "business-units"
                ? await this.db.businessUnit.findUnique({
                      where: { id: id as number },
                      include: this.businessUnitListInclude(),
                  })
                : await delegate.findUnique({ where: { id } });
        if (!row) {
            throw new NotFoundException({ error: `${entityType} not found` });
        }

        if (!isAdmin) {
            const scopeValue =
                config.scopeField === "id" ? row.id : row.account_id;
            if (scopeValue !== accountId) {
                throw new ForbiddenException({ error: "Access denied" });
            }
        }

        return serializeBigInt(row);
    }

    async update(
        entityType: AccountAdminEntityType,
        user: JwtPayload,
        id: number | string,
        body: Record<string, unknown>
    ) {
        const existing = (await this.getById(
            entityType,
            user,
            id
        )) as Record<string, unknown>;

        if (entityType === "business-units") {
            const userInfo = await this.accessScope.resolveUserInfo(user);
            const data: Record<string, unknown> = {
                modified_by: userInfo.userId,
                modified_at: new Date(),
            };
            if (typeof body.name === "string") data.name = body.name;
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
                where: { id: id as number },
                data,
                include: this.businessUnitListInclude(),
            });
            return serializeBigInt(updated);
        }

        const data: Record<string, unknown> = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.created_at;
        delete data.created_by;

        const delegate = this.delegate(entityType);
        const updated = await delegate.update({ where: { id }, data });
        const serialized = serializeBigInt(updated) as Record<string, unknown>;

        if (entityType === "users") {
            const userInfo = await this.accessScope.resolveUserInfo(user);
            if (String(id) === String(userInfo.userId)) {
                const sessionPatch = this.ownUserSessionUpdatePatch(
                    existing,
                    serialized,
                    body
                );
                if (sessionPatch) {
                    return { ...serialized, ...sessionPatch };
                }
            }
        }

        return serialized;
    }

    /**
     * When a user updates their own profile, tell the UI to refresh the
     * NextAuth session (and reload for language/RTL). Only set when a
     * session-relevant field actually changed.
     */
    private ownUserSessionUpdatePatch(
        existing: Record<string, unknown>,
        updated: Record<string, unknown>,
        body: Record<string, unknown>
    ): Record<string, unknown> | null {
        const patch: Record<string, unknown> = {};
        let required = false;

        if ("language" in body && updated.language !== existing.language) {
            required = true;
            patch.newLanguage = updated.language;
        }
        if ("locale" in body && updated.locale !== existing.locale) {
            required = true;
            patch.newLocale = updated.locale;
        }
        if ("name" in body && updated.name !== existing.name) {
            required = true;
            patch.newName = updated.name;
        }
        if (
            ("time_zone" in body || "timezone" in body) &&
            updated.time_zone !== existing.time_zone
        ) {
            required = true;
            patch.newTimezone = updated.time_zone;
        }

        if (!required) {
            return null;
        }
        return { sessionUpdateRequired: true, ...patch };
    }

    /**
     * Active collection agents for filters (legacy: GET .../users/collection-agents).
     */
    async listCollectionAgents(user: JwtPayload) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const effectiveAccountId =
            userInfo.viewAsUserAccountId || userInfo.accountId;

        const hasViewUsers = await this.accessScope.hasPermission(
            effectiveAccountId,
            effectiveRole,
            "view_users"
        );
        if (!hasViewUsers) {
            throw new ForbiddenException({
                error: "Access denied: You do not have permission to view users",
            });
        }

        const isAdmin = this.accessScope.isAdminAccount(effectiveAccountId);

        const loggedInUser = await this.db.user.findUnique({
            where: { id: userInfo.userId },
            select: { business_unit_id: true },
        });
        const loggedInUserBuId = loggedInUser?.business_unit_id ?? null;

        const buFilter = await this.accessScope.getUserBusinessUnitFilter(
            loggedInUserBuId,
            isAdmin,
            false
        );

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
            const businessUnit = agent.BusinessUnit as
                | { id: number; name: string }
                | null
                | undefined;
            return {
                ...agent,
                name:
                    agent.name ||
                    (agent.first_name && agent.last_name
                        ? `${agent.first_name} ${agent.last_name}`.trim()
                        : agent.first_name ||
                          agent.last_name ||
                          agent.email ||
                          `Agent ${agent.id}`),
                businessUnitName: businessUnit?.name || null,
            };
        });

        return serializeBigInt(agentsWithNames);
    }

    private parseNumericId(raw: string, label: string): number {
        const id = parseInt(raw, 10);
        if (Number.isNaN(id)) {
            throw new BadRequestException({ error: `Invalid ${label}` });
        }
        return id;
    }

    async listBusinessUnitBanks(user: JwtPayload, businessUnitIdRaw: string) {
        const { accountId } = await this.scope(user);
        const businessUnitId = this.parseNumericId(
            businessUnitIdRaw,
            "business unit ID"
        );

        const bu = await this.db.businessUnit.findFirst({
            where: { id: businessUnitId, account_id: accountId },
        });
        if (!bu) {
            throw new NotFoundException({ error: "Business unit not found" });
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
        return serializeBigInt(transformed);
    }

    async addBusinessUnitBank(
        user: JwtPayload,
        businessUnitIdRaw: string,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const businessUnitId = this.parseNumericId(
            businessUnitIdRaw,
            "business unit ID"
        );
        const bankAccountId = this.parseNumericId(
            String(body.bank_account_id ?? ""),
            "bank account ID"
        );

        const bu = await this.db.businessUnit.findFirst({
            where: { id: businessUnitId, account_id: accountId },
        });
        if (!bu) {
            throw new NotFoundException({ error: "Business unit not found" });
        }

        const bankAccount = await this.db.accountBankAccounts.findFirst({
            where: { id: bankAccountId, account_id: accountId },
        });
        if (!bankAccount) {
            throw new NotFoundException({ error: "Bank account not found" });
        }

        const existing = await this.db.businessUnitBankAccounts.findFirst({
            where: {
                business_unit_id: businessUnitId,
                bank_account_id: bankAccountId,
            },
        });
        if (existing) {
            throw new BadRequestException({
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

        return serializeBigInt({
            ...created,
            CustomerBankAccount: created.AccountBankAccounts,
        });
    }

    async removeBusinessUnitBank(
        user: JwtPayload,
        businessUnitIdRaw: string,
        junctionIdRaw: string
    ) {
        const { accountId } = await this.scope(user);
        const businessUnitId = this.parseNumericId(
            businessUnitIdRaw,
            "business unit ID"
        );
        const junctionId = this.parseNumericId(junctionIdRaw, "junction ID");

        const bu = await this.db.businessUnit.findFirst({
            where: { id: businessUnitId, account_id: accountId },
        });
        if (!bu) {
            throw new NotFoundException({ error: "Business unit not found" });
        }

        const buBank = await this.db.businessUnitBankAccounts.findFirst({
            where: {
                id: junctionId,
                business_unit_id: businessUnitId,
                account_id: accountId,
            },
        });
        if (!buBank) {
            throw new NotFoundException({
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

    async listCustomerBanks(
        user: JwtPayload,
        customerIdRaw: string,
        query: AccountAdminListQuery = {}
    ) {
        const { accountId } = await this.scope(user);
        const customerId = this.parseNumericId(customerIdRaw, "customer ID");
        const limit = Math.min(
            parseInt(query.limit || "1000", 10) || 1000,
            5000
        );

        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: { id: true, account_id: true },
        });
        if (!customer) {
            throw new NotFoundException({ error: "Customer not found" });
        }

        const rows = await this.db.customerBanks.findMany({
            where: {
                customer_id: customerId,
                account_id: accountId,
            },
            take: limit,
            orderBy: { id: "asc" },
            include: {
                AccountBankAccounts: {
                    include: { Country: true },
                },
            },
        });

        return serializeBigInt({
            data: rows,
            totalRecords: rows.length,
        });
    }

    async addCustomerBank(
        user: JwtPayload,
        customerIdRaw: string,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const customerId = this.parseNumericId(customerIdRaw, "customer ID");
        const bankAccountId = this.parseNumericId(
            String(
                body.customer_bank_account_id ??
                    body.bank_account_id ??
                    body.account_bank_account_id ??
                    ""
            ),
            "bank account ID"
        );

        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: { id: true, account_id: true },
        });
        if (!customer) {
            throw new NotFoundException({ error: "Customer not found" });
        }

        const bankAccount = await this.db.accountBankAccounts.findFirst({
            where: { id: bankAccountId, account_id: accountId },
        });
        if (!bankAccount) {
            throw new NotFoundException({ error: "Bank account not found" });
        }

        const existing = await this.db.customerBanks.findFirst({
            where: {
                customer_id: customerId,
                customer_bank_account_id: bankAccountId,
            },
        });
        if (existing) {
            throw new BadRequestException({
                error: "Bank account is already assigned to this customer",
            });
        }

        const created = await this.db.customerBanks.create({
            data: {
                customer_id: customerId,
                account_id: accountId,
                customer_bank_account_id: bankAccountId,
                created_by: userInfo.userId,
                modified_by: userInfo.userId,
            },
            include: {
                AccountBankAccounts: {
                    include: { Country: true },
                },
            },
        });

        return serializeBigInt(created);
    }

    async removeCustomerBank(
        user: JwtPayload,
        customerIdRaw: string,
        junctionIdRaw: string
    ) {
        const { accountId } = await this.scope(user);
        const customerId = this.parseNumericId(customerIdRaw, "customer ID");
        const junctionId = this.parseNumericId(junctionIdRaw, "junction ID");

        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: { id: true },
        });
        if (!customer) {
            throw new NotFoundException({ error: "Customer not found" });
        }

        const row = await this.db.customerBanks.findFirst({
            where: {
                id: junctionId,
                customer_id: customerId,
                account_id: accountId,
            },
        });
        if (!row) {
            throw new NotFoundException({
                error: "Customer bank assignment not found",
            });
        }

        await this.db.customerBanks.delete({ where: { id: row.id } });

        return {
            message: "Bank account removed from customer successfully",
        };
    }
}
