import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma, type InsurancePolicy } from "@prisma/client";
import {
    applyInsurancePolicyUpdateWithCustomerPush,
    CLEARED_INSURANCE_POLICY_PENDING_REVISION,
    coercePolicyDateFields,
    enqueueAsOfRewrite,
    enqueueInsurancePolicyUpdateAsOfRewrite,
    INSURANCE_POLICY_PUSH_TRANSACTION_TIMEOUT_MS,
    InsurancePolicyUpdateDataError,
    loadPolicyPushCandidates,
    omitNullTopUpTermDates,
    prepareInsurancePolicyUpdateData,
    startOfTodayUtc,
    toInsuranceEntityUpdateData,
} from "@archaser/credit-insurance-domain";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import {
    listChangedPolicyPushFields,
    pickPolicyPushSnapshot,
    type PolicyPushCustomerField,
} from "./domain/hasMeaningfulCustomerPolicyFieldChange";
import { planPolicyPushToCustomers } from "./domain/policyPushCustomerPlan";
import { resolveInsurancePolicySaveEffectiveDate } from "./domain/insurancePolicySaveEffectiveDate";
import { parseAnnualCreditAssessmentFee } from "./domain/annualCreditAssessmentFee";
import { applyInsurancePolicyCommercialTerms } from "./domain/policyCommercialTerms";
import { parseRegistrationFeePercent } from "./domain/registrationFeePercent";

function withPolicyDataBadRequest<T>(run: () => T): T {
    try {
        return run();
    } catch (error) {
        if (error instanceof InsurancePolicyUpdateDataError) {
            throw new BadRequestException({ error: error.message });
        }
        throw error;
    }
}

function hasUsablePolicyTermDate(value: unknown): boolean {
    return value instanceof Date && !Number.isNaN(value.getTime());
}

function resolveSaveEffectiveDateOrThrow(raw: unknown): {
    effectiveDate: Date;
    isFuture: boolean;
} {
    const resolved = resolveInsurancePolicySaveEffectiveDate(
        raw,
        startOfTodayUtc()
    );
    if (!resolved.ok) {
        throw new BadRequestException({
            error:
                resolved.code === "EFFECTIVE_DATE_IN_PAST"
                    ? "effective_date must be today or a future date"
                    : "effective_date must be a valid date (YYYY-MM-DD)",
            code: resolved.code,
        });
    }
    return resolved;
}

function pendingRevisionExistsError(): ConflictException {
    return new ConflictException({
        error: "A scheduled policy change exists. Cancel it before making further policy changes.",
        code: "INSURANCE_POLICY_PENDING_REVISION_EXISTS",
    });
}

function assertNoPendingInsurancePolicyRevision(
    policy: Pick<InsurancePolicy, "pending_effective_date">
): void {
    if (policy.pending_effective_date != null) {
        throw pendingRevisionExistsError();
    }
}

function policyPushValueForDisplay(value: unknown): string | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    return String(value);
}

export type InsurancePolicySavePreview = {
    policy_id: number;
    /** True when ≥1 customer-push field changed; the UI must confirm before PUT. */
    requires_confirmation: boolean;
    changed_fields: Array<{
        field: PolicyPushCustomerField;
        old_value: string | null;
        new_value: string | null;
        customer_count: number;
    }>;
    unique_customer_count: number;
    skipped_pending_customer_count: number;
    active_customer_count: number;
};

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
            start_date: true,
            end_date: true,
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
                pending_changed_fields:
                    this.listPendingRevisionChangedPushFields(row),
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

        const data = toInsuranceEntityUpdateData(body);

        if (entityType === "insurance-policies") {
            const policy = await this.findAccountPolicyOrThrow(
                accountId,
                Number(id)
            );
            assertNoPendingInsurancePolicyRevision(policy);
            const effective = resolveSaveEffectiveDateOrThrow(
                body.effective_date
            );
            const formSnapshot = { ...data };
            this.prepareInsurancePolicyUpdateData(policy, data);
            const userInfo = await this.accessScope.resolveUserInfo(user);
            if (effective.isFuture) {
                return this.schedulePendingInsurancePolicyRevision({
                    accountId,
                    policy,
                    preparedData: data,
                    formSnapshot,
                    effectiveDate: effective.effectiveDate,
                    userId: userInfo.userId,
                });
            }
            try {
                const { policy: updated } = await this.db.$transaction(
                    (tx) =>
                        applyInsurancePolicyUpdateWithCustomerPush({
                            tx,
                            accountId,
                            policyBefore: policy,
                            data,
                            userId: userInfo.userId,
                            customerVersionStartDate: startOfTodayUtc(),
                        }),
                    { timeout: INSURANCE_POLICY_PUSH_TRANSACTION_TIMEOUT_MS }
                );
                await enqueueInsurancePolicyUpdateAsOfRewrite({
                    accountId,
                    before: policy,
                    after: updated,
                });
                return serializeBigInt(updated);
            } catch (error) {
                if (
                    error instanceof BadRequestException ||
                    error instanceof NotFoundException
                ) {
                    throw error;
                }
                const message =
                    error instanceof Error ? error.message : String(error);
                throw new BadRequestException({
                    error:
                        message ||
                        "Failed to push insurance policy terms to customers",
                });
            }
        }

        const delegate = this.delegate(entityType);
        const updated = await delegate.update({ where: { id }, data });
        return serializeBigInt(updated);
    }

    /**
     * Dry-run of an Insurance Policy save: which customer-push fields change
     * and how many active Customer Policies the PUT would version. Takes the
     * same body as PUT; nothing is written.
     */
    async previewInsurancePolicySave(
        user: JwtPayload,
        policyId: number,
        body: Record<string, unknown>
    ): Promise<InsurancePolicySavePreview> {
        const accountId = await this.accountId(user);
        const policy = await this.findAccountPolicyOrThrow(accountId, policyId);
        assertNoPendingInsurancePolicyRevision(policy);
        const data = toInsuranceEntityUpdateData(body);
        this.prepareInsurancePolicyUpdateData(policy, data);
        const policyAfter = { ...policy, ...data } as InsurancePolicy;

        const { activeRows, pendingCustomerIds } =
            await loadPolicyPushCandidates(this.db, accountId, policyId);
        const plan = planPolicyPushToCustomers({
            policyBefore: policy,
            policyAfter,
            activeRows,
            pendingCustomerIds,
        });

        return {
            policy_id: policyId,
            requires_confirmation: plan.fieldsToPush.length > 0,
            changed_fields: plan.fieldsToPush.map((field) => ({
                field,
                old_value: policyPushValueForDisplay(policy[field]),
                new_value: policyPushValueForDisplay(policyAfter[field]),
                customer_count: plan.customerCountByField[field],
            })),
            unique_customer_count: plan.uniqueCustomerCount,
            skipped_pending_customer_count: plan.skippedPendingCustomerCount,
            active_customer_count: new Set(
                activeRows.map((row) => row.customer_id)
            ).size,
        };
    }

    /**
     * Future-dated save: store the form snapshot as the single pending
     * revision. Live policy columns and Customer Policies are not touched
     * until activation; no as-of rewrite is enqueued.
     */
    private async schedulePendingInsurancePolicyRevision(args: {
        accountId: number;
        policy: InsurancePolicy;
        preparedData: Record<string, unknown>;
        formSnapshot: Record<string, unknown>;
        effectiveDate: Date;
        userId: string;
    }) {
        const { accountId, policy } = args;
        const changedPushFields = listChangedPolicyPushFields(
            pickPolicyPushSnapshot(policy),
            pickPolicyPushSnapshot({
                ...policy,
                ...args.preparedData,
            } as InsurancePolicy)
        );
        if (changedPushFields.length === 0) {
            throw new BadRequestException({
                error: "A future effective date is only allowed when customer policy terms change",
                code: "FUTURE_EFFECTIVE_DATE_REQUIRES_PUSH_CHANGE",
            });
        }
        const result = await this.db.insurancePolicy.updateMany({
            where: {
                id: policy.id,
                account_id: accountId,
                pending_effective_date: null,
            },
            data: {
                pending_effective_date: args.effectiveDate,
                pending_payload: args.formSnapshot as Prisma.InputJsonObject,
                pending_created_at: new Date(),
                pending_created_by: args.userId,
            },
        });
        if (result.count === 0) {
            throw pendingRevisionExistsError();
        }
        return serializeBigInt(
            await this.findAccountPolicyOrThrow(accountId, policy.id)
        );
    }

    /** Clear the pending revision; unlocks the policy form. No customer writes. */
    async cancelPendingInsurancePolicyRevision(
        user: JwtPayload,
        policyId: number
    ): Promise<{ id: number }> {
        const accountId = await this.accountId(user);
        const policy = await this.findAccountPolicyOrThrow(accountId, policyId);
        const result =
            policy.pending_effective_date == null
                ? { count: 0 }
                : await this.db.insurancePolicy.updateMany({
                      where: {
                          id: policyId,
                          account_id: accountId,
                          pending_effective_date: { not: null },
                      },
                      data: CLEARED_INSURANCE_POLICY_PENDING_REVISION,
                  });
        if (result.count === 0) {
            throw new NotFoundException({
                error: "No scheduled policy change to cancel",
                code: "INSURANCE_POLICY_PENDING_REVISION_NOT_FOUND",
            });
        }
        return { id: policyId };
    }

    /** Push fields the pending snapshot changes vs the live policy (banner summary). */
    private listPendingRevisionChangedPushFields(
        policy: InsurancePolicy
    ): PolicyPushCustomerField[] {
        const payload = policy.pending_payload;
        if (
            policy.pending_effective_date == null ||
            payload == null ||
            typeof payload !== "object" ||
            Array.isArray(payload)
        ) {
            return [];
        }
        const data = toInsuranceEntityUpdateData(
            payload as Record<string, unknown>
        );
        try {
            this.prepareInsurancePolicyUpdateData(policy, data);
        } catch {
            return [];
        }
        return listChangedPolicyPushFields(
            pickPolicyPushSnapshot(policy),
            pickPolicyPushSnapshot({ ...policy, ...data } as InsurancePolicy)
        );
    }

    private async findAccountPolicyOrThrow(
        accountId: number,
        policyId: number
    ): Promise<InsurancePolicy> {
        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: policyId, account_id: accountId },
        });
        if (!policy) {
            throw new NotFoundException({ error: "insurance-policies not found" });
        }
        return policy;
    }

    /** Normalize a PUT body in place (dates, fees, commercial terms). */
    private prepareInsurancePolicyUpdateData(
        policy: InsurancePolicy,
        data: Record<string, unknown>
    ): void {
        withPolicyDataBadRequest(() =>
            prepareInsurancePolicyUpdateData(policy, data)
        );
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
            const createData: Record<string, unknown> = { ...body };
            withPolicyDataBadRequest(() => coercePolicyDateFields(createData));
            if (policyKind === "TopUp") {
                omitNullTopUpTermDates(createData);
                const parentId = Number(createData.parent_insurance_policy_id);
                if (!Number.isFinite(parentId)) {
                    throw new BadRequestException({
                        error: "parent_insurance_policy_id is required for TopUp policies",
                    });
                }
                const parent = await this.db.insurancePolicy.findFirst({
                    where: {
                        id: parentId,
                        account_id: accountId,
                        policy_kind: "Primary",
                    },
                    select: { id: true, start_date: true, end_date: true },
                });
                if (!parent) {
                    throw new BadRequestException({
                        error: "parent_insurance_policy_id must reference a Primary policy on this account",
                    });
                }
                // TopUp UI does not collect term dates; inherit from parent Primary.
                if (!hasUsablePolicyTermDate(createData.start_date)) {
                    createData.start_date = parent.start_date;
                }
                if (!hasUsablePolicyTermDate(createData.end_date)) {
                    createData.end_date = parent.end_date;
                }
            }
            if (
                !hasUsablePolicyTermDate(createData.start_date) ||
                !hasUsablePolicyTermDate(createData.end_date)
            ) {
                throw new BadRequestException({
                    error: "start_date and end_date are required",
                });
            }
            try {
                applyInsurancePolicyCommercialTerms(createData, policyKind, {
                    mode: "create",
                });
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                throw new BadRequestException({
                    error:
                        message ||
                        "Invalid insurance policy commercial terms",
                });
            }
            const created = await this.db.insurancePolicy.create({
                data: {
                    ...createData,
                    account_id: accountId,
                    policy_kind: policyKind,
                    registration_fee_percent: parseRegistrationFeePercent(
                        createData.registration_fee_percent,
                        policyKind
                    ),
                    annual_credit_assessment_fee:
                        parseAnnualCreditAssessmentFee(
                            createData.annual_credit_assessment_fee,
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
                mep_cutoff_day: true,
                mep_substitute_extra_days: true,
                reporting_cutoff_day: true,
                reporting_substitute_extra_days: true,
                payment_term_cutoff_day: true,
                payment_term_substitute_day: true,
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
            mep_cutoff_day: policy.mep_cutoff_day ?? null,
            mep_substitute_extra_days:
                policy.mep_substitute_extra_days ?? null,
            reporting_cutoff_day:
                policy.reporting_cutoff_day ?? null,
            reporting_substitute_extra_days:
                policy.reporting_substitute_extra_days ?? null,
            payment_term_cutoff_day:
                policy.payment_term_cutoff_day ?? null,
            payment_term_substitute_day:
                policy.payment_term_substitute_day ?? null,
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
