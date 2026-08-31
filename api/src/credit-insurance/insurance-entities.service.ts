import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import { enqueueAsOfRewrite } from "@archaser/credit-insurance-domain";
import { parseRegistrationFeePercent } from "./domain/registrationFeePercent";

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

const POLICY_DETAIL_INCLUDE = {
    InsurancePolicyCountry: {
        include: { Country: { select: { name: true, iso2: true } } },
        orderBy: { country_id: "asc" },
    },
    NamedPolicy: { orderBy: { customer_number: "asc" } },
    ParentInsurancePolicy: {
        select: {
            id: true,
            policy_number: true,
            insurer_name: true,
            status: true,
        },
    },
} as const;

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
            ? await delegate.findUnique({
                  where: { id },
                  // The policy detail screen renders the country and named-customer
                  // grids straight off this payload.
                  ...(entityType === "insurance-policies"
                      ? { include: POLICY_DETAIL_INCLUDE }
                      : {}),
              })
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

        if (entityType === "insurance-policies") {
            return serializeBigInt({
                ...row,
                NamedPolicy: await this.attachNamedCustomers(
                    accountId,
                    row.NamedPolicy ?? []
                ),
            });
        }

        return serializeBigInt(row);
    }

    /**
     * NamedPolicy stores a bare customer number, so the grid's name/link columns
     * need a lookup against the account's customers.
     */
    private async attachNamedCustomers(
        accountId: number,
        namedRows: Array<{ customer_number: string }>
    ) {
        if (namedRows.length === 0) return namedRows;

        const customers = await this.db.customer.findMany({
            where: {
                account_id: accountId,
                customer_number: {
                    in: [...new Set(namedRows.map((r) => r.customer_number))],
                },
            },
            select: {
                id: true,
                customer_number: true,
                Company: { select: { name: true } },
                Person: { select: { full_name: true } },
            },
        });
        const byNumber = new Map(
            customers.map((c) => [c.customer_number, c])
        );

        return namedRows.map((named) => {
            const customer = byNumber.get(named.customer_number);
            return {
                ...named,
                customer_id: customer?.id ?? null,
                customer_name:
                    customer?.Company?.name ??
                    customer?.Person?.full_name ??
                    null,
            };
        });
    }

    async update(
        entityType: InsuranceEntityType,
        user: JwtPayload,
        id: number | string,
        body: Record<string, unknown>
    ) {
        await this.getById(entityType, user, id);
        const accountId = await this.accountId(user);

        const data: Record<string, unknown> = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.insurance_policy_id;
        delete data.created_at;
        delete data.created_by;
        delete data.InsurancePolicy;

        if (entityType === "insurance-policies") {
            const policy = await this.db.insurancePolicy.findFirst({
                where: { id: Number(id), account_id: accountId },
                select: { policy_kind: true, start_date: true },
            });
            if (!policy) {
                throw new NotFoundException({ error: "insurance-policies not found" });
            }
            data.registration_fee_percent = parseRegistrationFeePercent(
                data.registration_fee_percent,
                policy.policy_kind
            );
            const userInfo = await this.accessScope.resolveUserInfo(user);
            const updated = await this.db.$transaction(async (tx) => {
                const policyUpdate = await tx.insurancePolicy.update({
                    where: { id: Number(id) },
                    data: {
                        ...data,
                        modified_by: userInfo.userId,
                    } as never,
                });
                await tx.customerPolicy.updateMany({
                    where: {
                        insurance_policy_id: Number(id),
                        is_active: true,
                        Customer: { account_id: accountId },
                    },
                    data: {
                        cost_percent: policyUpdate.cost_percent,
                        registration_fee_percent:
                            policyUpdate.registration_fee_percent,
                        modified_by: userInfo.userId,
                    },
                });
                return policyUpdate;
            });
            await enqueueAsOfRewrite({
                accountId,
                fromDate:
                    updated.start_date < policy.start_date
                        ? updated.start_date
                        : policy.start_date,
                toDate: new Date(),
            });
            return serializeBigInt(updated);
        }

        const delegate = this.delegate(entityType);
        const updated = await delegate.update({ where: { id }, data });
        return serializeBigInt(updated);
    }

    async create(
        entityType: InsuranceEntityType,
        user: JwtPayload,
        body: Record<string, unknown>
    ) {
        if (entityType === "insurance-policies") {
            const accountId = await this.accountId(user);
            const userInfo = await this.accessScope.resolveUserInfo(user);
            const policyKind =
                body.policy_kind === "TopUp" ? "TopUp" : "Primary";
            const created = await this.db.insurancePolicy.create({
                data: {
                    ...body,
                    account_id: accountId,
                    policy_kind: policyKind,
                    registration_fee_percent: parseRegistrationFeePercent(
                        body.registration_fee_percent,
                        policyKind
                    ),
                    created_by: userInfo.userId,
                    modified_by: userInfo.userId,
                } as never,
            });
            await enqueueAsOfRewrite({
                accountId,
                fromDate: created.start_date,
                toDate: new Date(),
            });
            return serializeBigInt(created);
        }

        const accountId = await this.accountId(user);
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const policyId = Number(body.insurance_policy_id);
        if (!Number.isFinite(policyId)) {
            throw new BadRequestException({
                error: "insurance_policy_id is required",
            });
        }

        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: policyId, account_id: accountId },
            select: { id: true },
        });
        if (!policy) {
            throw new NotFoundException({ error: "Policy not found" });
        }

        if (entityType === "insurance-policy-countries") {
            const countryId = Number(body.country_id);
            if (!Number.isFinite(countryId)) {
                throw new BadRequestException({
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
                payment_term_cap:
                    body.payment_term_cap == null
                        ? null
                        : Number(body.payment_term_cap),
                country_mep:
                    body.country_mep == null ? null : Number(body.country_mep),
                reporting_days:
                    body.reporting_days == null
                        ? null
                        : Number(body.reporting_days),
                country_max_limit:
                    body.country_max_limit == null
                        ? null
                        : body.country_max_limit,
                modified_by: userInfo.userId,
            };
            if (existing) {
                const updated = await this.db.insurancePolicyCountry.update({
                    where: { id: existing.id },
                    data: data as never,
                });
                return serializeBigInt(updated);
            }
            const created = await this.db.insurancePolicyCountry.create({
                data: {
                    insurance_policy_id: policyId,
                    country_id: countryId,
                    ...data,
                    created_by: userInfo.userId,
                } as never,
            });
            return serializeBigInt(created);
        }

        const customerNumber = String(body.customer_number || "").trim();
        if (!customerNumber) {
            throw new BadRequestException({
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
            max_payment_term:
                body.max_payment_term == null
                    ? null
                    : Number(body.max_payment_term),
            customer_mep:
                body.customer_mep == null ? null : Number(body.customer_mep),
            reporting_days:
                body.reporting_days == null
                    ? null
                    : Number(body.reporting_days),
            customer_max_limit:
                body.customer_max_limit == null
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
                data: namedData as never,
            });
            return serializeBigInt(updated);
        }
        const created = await this.db.namedPolicy.create({
            data: {
                insurance_policy_id: policyId,
                customer_number: customerNumber,
                ...namedData,
                created_by: userInfo.userId,
            } as never,
        });
        return serializeBigInt(created);
    }

    async remove(
        entityType: InsuranceEntityType,
        user: JwtPayload,
        id: number | string
    ) {
        if (entityType === "insurance-policies") {
            throw new BadRequestException({
                error: "Policy delete not supported here",
            });
        }
        await this.getById(entityType, user, id);
        const delegate = this.delegate(entityType);
        await delegate.delete({ where: { id } });
        return { success: true };
    }

    async customerPrefill(
        user: JwtPayload,
        policyId: number,
        query: Record<string, string | undefined>
    ) {
        const accountId = await this.accountId(user);
        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: policyId, account_id: accountId },
            select: {
                max_payment_term: true,
                max_allowed_mep: true,
                reporting_days: true,
                mep_cutoff_day_of_month: true,
                mep_substitute_day_of_month: true,
                reporting_cutoff_day_of_month: true,
                reporting_substitute_day_of_month: true,
                payment_term_cutoff_day_of_month: true,
                payment_term_substitute_day_of_month: true,
                min_credit_score: true,
                max_dcl: true,
                cost_percent: true,
                registration_fee_percent: true,
            },
        });
        if (!policy) {
            throw new NotFoundException({ error: "Policy not found" });
        }

        const countryId = query.country_id
            ? parseInt(query.country_id, 10)
            : null;
        const customerNumber = query.customer_number?.trim() || null;
        const customerNumberPolicy =
            query.customer_number_policy?.trim() || null;
        const namedMatchByPolicyCustomerNumberOnly =
            query.named_match === "policy_customer_number";
        const dclOnly =
            query.limit_type === "DCL" || query.limit_type === "Discretionary";

        let countryRow: {
            payment_term_cap: number | null;
            country_mep: number | null;
            reporting_days: number | null;
            country_max_limit: unknown;
        } | null = null;
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
                    country_max_limit: true,
                },
            });
        }

        const namedSelect = {
            customer_number: true,
            max_payment_term: true,
            customer_mep: true,
            reporting_days: true,
            customer_max_limit: true,
            limit_expiration_date: true,
        } as const;

        let named: {
            max_payment_term: number | null;
            customer_mep: number | null;
            reporting_days: number | null;
            customer_max_limit: unknown;
            limit_expiration_date: Date | null;
            customer_number: string;
        } | null = null;

        if (!dclOnly && namedMatchByPolicyCustomerNumberOnly) {
            if (customerNumberPolicy) {
                named = await this.db.namedPolicy.findFirst({
                    where: {
                        insurance_policy_id: policyId,
                        customer_number: customerNumberPolicy,
                    },
                    select: namedSelect,
                });
            }
            if (!named && customerNumber) {
                named = await this.db.namedPolicy.findFirst({
                    where: {
                        insurance_policy_id: policyId,
                        customer_number: customerNumber,
                    },
                    select: namedSelect,
                });
            }
            if (!named) {
                return serializeBigInt({ source: "no_named_match" });
            }
        } else if (!dclOnly) {
            if (customerNumber) {
                named = await this.db.namedPolicy.findFirst({
                    where: {
                        insurance_policy_id: policyId,
                        customer_number: customerNumber,
                    },
                    select: namedSelect,
                });
            }
            if (!named && customerNumberPolicy) {
                named = await this.db.namedPolicy.findFirst({
                    where: {
                        insurance_policy_id: policyId,
                        customer_number: customerNumberPolicy,
                    },
                    select: namedSelect,
                });
            }
        }

        const monthEndFields = {
            mep_cutoff_day_of_month: policy.mep_cutoff_day_of_month ?? null,
            mep_substitute_day_of_month:
                policy.mep_substitute_day_of_month ?? null,
            reporting_cutoff_day_of_month:
                policy.reporting_cutoff_day_of_month ?? null,
            reporting_substitute_day_of_month:
                policy.reporting_substitute_day_of_month ?? null,
            payment_term_cutoff_day_of_month:
                policy.payment_term_cutoff_day_of_month ?? null,
            payment_term_substitute_day_of_month:
                policy.payment_term_substitute_day_of_month ?? null,
        };

        if (named) {
            let approvedLimit: unknown = named.customer_max_limit;
            if (approvedLimit == null && countryRow) {
                approvedLimit = countryRow.country_max_limit;
            }
            if (approvedLimit == null) {
                approvedLimit = policy.max_dcl;
            }

            return serializeBigInt({
                source: "named_policy",
                limit_type: "Named",
                max_payment_term:
                    named.max_payment_term ??
                    countryRow?.payment_term_cap ??
                    policy.max_payment_term ??
                    null,
                max_allowed_mep:
                    named.customer_mep ??
                    countryRow?.country_mep ??
                    policy.max_allowed_mep ??
                    null,
                reporting_days:
                    named.reporting_days ??
                    countryRow?.reporting_days ??
                    policy.reporting_days ??
                    null,
                ...monthEndFields,
                approved_limit: approvedLimit,
                approved_limit_expiration_date:
                    named.limit_expiration_date ?? null,
                cost_percent: policy.cost_percent ?? null,
                registration_fee_percent: policy.registration_fee_percent ?? null,
                credit_score: policy.min_credit_score ?? null,
                customer_number_policy: named.customer_number,
            });
        }

        if (countryRow) {
            return serializeBigInt({
                source: "country",
                limit_type: "DCL",
                max_payment_term:
                    countryRow.payment_term_cap ?? policy.max_payment_term ?? null,
                max_allowed_mep:
                    countryRow.country_mep ?? policy.max_allowed_mep ?? null,
                reporting_days:
                    countryRow.reporting_days ?? policy.reporting_days ?? null,
                ...monthEndFields,
                approved_limit:
                    countryRow.country_max_limit ?? policy.max_dcl ?? null,
                approved_limit_expiration_date: null,
                cost_percent: policy.cost_percent ?? null,
                registration_fee_percent: policy.registration_fee_percent ?? null,
                credit_score: policy.min_credit_score ?? null,
                customer_number_policy: null,
            });
        }

        return serializeBigInt({
            source: "policy",
            limit_type: "DCL",
            max_payment_term: policy.max_payment_term ?? null,
            max_allowed_mep: policy.max_allowed_mep ?? null,
            reporting_days: policy.reporting_days ?? null,
            ...monthEndFields,
            approved_limit: policy.max_dcl ?? null,
            approved_limit_expiration_date: null,
            cost_percent: policy.cost_percent ?? null,
            registration_fee_percent: policy.registration_fee_percent ?? null,
            credit_score: policy.min_credit_score ?? null,
            customer_number_policy: null,
        });
    }

    async bulkReplacePolicy(
        user: JwtPayload,
        body: { oldPolicyId?: number; newPolicyId?: number }
    ) {
        const accountId = await this.accountId(user);
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const oldPolicyId = Number(body.oldPolicyId);
        const newPolicyId = Number(body.newPolicyId);
        if (!Number.isFinite(oldPolicyId) || !Number.isFinite(newPolicyId)) {
            throw new BadRequestException({
                error: "oldPolicyId and newPolicyId are required",
            });
        }
        if (oldPolicyId === newPolicyId) {
            throw new BadRequestException({
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
                select: {
                    id: true,
                    cost_percent: true,
                    registration_fee_percent: true,
                },
            }),
        ]);
        if (!oldP || !newP) {
            throw new NotFoundException({ error: "Policy not found" });
        }
        const result = await this.db.customerPolicy.updateMany({
            where: {
                insurance_policy_id: oldPolicyId,
                Customer: { account_id: accountId },
            },
            data: {
                insurance_policy_id: newPolicyId,
                cost_percent: newP.cost_percent,
                registration_fee_percent: newP.registration_fee_percent,
                modified_by: userInfo.userId,
            },
        });
        return { updatedCount: result.count };
    }
}
