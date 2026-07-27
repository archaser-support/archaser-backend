import {
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

export const ACCOUNT_ADMIN_ENTITY_TYPES = [
    "accounts",
    "users",
    "business-units",
    "bank-accounts",
    "customer-banks",
    "business-unit-banks",
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
        | "customerBanks"
        | "businessUnitBankAccounts";
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
    "business-unit-banks": {
        delegate: "businessUnitBankAccounts",
        scopeField: "account_id",
        listKey: "businessUnitBanks",
        idType: "number",
    },
};

export type AccountAdminListQuery = {
    page?: string;
    limit?: string;
    search?: string;
};

@Injectable()
export class AccountAdminEntitiesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
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

        const where: Record<string, unknown> =
            isAdmin && config.scopeField === "id"
                ? {}
                : isAdmin && config.scopeField === "account_id"
                  ? {}
                  : { [config.scopeField]: accountId };

        if (query.search && config.searchFields?.length) {
            (where.OR as unknown) = config.searchFields.map((field) => ({
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

        // Legacy pagination shapes for settings UIs.
        if (entityType === "business-units") {
            return serializeBigInt({
                data: rows,
                total: totalRecords,
            });
        }
        if (entityType === "bank-accounts") {
            return serializeBigInt({
                data: rows,
                total: totalRecords,
            });
        }
        if (entityType === "customer-banks") {
            return serializeBigInt({
                data: rows,
                totalRecords,
                page,
                limit,
            });
        }
        if (entityType === "users") {
            return serializeBigInt({
                users: rows,
                total: totalRecords,
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

    /**
     * Dropdown list (no page/limit): plain array matching legacy handler.
     */
    private async listBusinessUnitsDropdown(user: JwtPayload) {
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

    async getById(
        entityType: AccountAdminEntityType,
        user: JwtPayload,
        id: number | string
    ) {
        const { accountId, isAdmin } = await this.scope(user);
        const config = ENTITY_CONFIG[entityType];
        const delegate = this.delegate(entityType);

        const row = await delegate.findUnique({ where: { id } });
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
        await this.getById(entityType, user, id);

        const data: Record<string, unknown> = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.created_at;
        delete data.created_by;

        const delegate = this.delegate(entityType);
        const updated = await delegate.update({ where: { id }, data });
        return serializeBigInt(updated);
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
}
