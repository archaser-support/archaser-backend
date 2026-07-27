import {
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

export const INSURANCE_ENTITY_TYPES = [
    "insurance-policies",
    "insurance-policy-countries",
    "insurance-policy-named-policies",
] as const;

export type InsuranceEntityType = (typeof INSURANCE_ENTITY_TYPES)[number];

type EntityConfig = {
    delegate: "insurancePolicy" | "insurancePolicyCountry" | "namedPolicy";
    listKey: string;
    /** Directly scoped by account_id, or via the InsurancePolicy relation. */
    direct: boolean;
    idType: "number" | "string";
};

const ENTITY_CONFIG: Record<InsuranceEntityType, EntityConfig> = {
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

export type InsuranceEntityListQuery = {
    page?: string;
    limit?: string;
};

@Injectable()
export class InsuranceEntitiesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    private delegate(entityType: InsuranceEntityType) {
        const config = ENTITY_CONFIG[entityType];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.db as any)[config.delegate];
    }

    private async accountId(user: JwtPayload): Promise<number> {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveAccountId(userInfo);
    }

    parseId(entityType: InsuranceEntityType, raw: string): number | string {
        const config = ENTITY_CONFIG[entityType];
        if (config.idType === "string") {
            return raw;
        }
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed)) {
            throw new NotFoundException({ error: "Invalid id" });
        }
        return parsed;
    }

    async list(
        entityType: InsuranceEntityType,
        user: JwtPayload,
        query: InsuranceEntityListQuery
    ) {
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

        return serializeBigInt({
            [config.listKey]: rows,
            totalRecords,
            page,
            limit,
        });
    }

    async getById(
        entityType: InsuranceEntityType,
        user: JwtPayload,
        id: number | string
    ) {
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
            throw new NotFoundException({ error: `${entityType} not found` });
        }

        const scopeAccountId = config.direct
            ? row.account_id
            : row.InsurancePolicy?.account_id;
        if (scopeAccountId !== accountId) {
            throw new ForbiddenException({ error: "Access denied" });
        }

        return serializeBigInt(row);
    }

    async update(
        entityType: InsuranceEntityType,
        user: JwtPayload,
        id: number | string,
        body: Record<string, unknown>
    ) {
        await this.getById(entityType, user, id);

        const data: Record<string, unknown> = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.insurance_policy_id;
        delete data.created_at;
        delete data.created_by;
        delete data.InsurancePolicy;

        const delegate = this.delegate(entityType);
        const updated = await delegate.update({ where: { id }, data });
        return serializeBigInt(updated);
    }
}
