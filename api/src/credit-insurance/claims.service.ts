import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import {
    applyClaimExcess,
    CLAIM_STATUSES_WITH_EXCESS,
    remainingExcessForPolicyYear,
    shouldApplyExcessOnTransition,
    shouldReverseExcessOnTransition,
} from "./domain/claims/claimExcess";
import { evaluateClaimEligibility } from "./domain/claims/claimEligibility";
import {
    assertSubmittedRequirements,
    CLAIM_STATUSES,
    isClaimStatus,
    normalizeClaimStatus,
    requiresLossDate,
    toDbClaimStatus,
    type ClaimStatus,
} from "./domain/claims/claimStatus";
import { defaultRecognizedLoss } from "./domain/claims/defaultRecognizedLoss";
import {
    listPolicyAnniversaryYears,
    resolvePolicyAnniversaryYear,
} from "./domain/claims/policyAnniversaryYear";

export type ClaimsListQuery = {
    page?: string;
    limit?: string;
    status?: string;
    customer_id?: string;
    /** When true, exclude Paid / Rejected / Canceled. */
    open_only?: string;
    /**
     * When true, only claims linked to Due/Overdue invoices
     * (matches customer unpaid-invoices claims system report).
     */
    unpaid_invoice_only?: string;
    insurance_policy_id?: string;
    policy_year?: string;
};

/** Invoice statuses treated as unpaid for claims banner / unpaid claims report. */
const UNPAID_INVOICE_STATUSES_FOR_CLAIMS = ["Due", "Overdue"] as const;

/** Match insurance-entities parseDateOnly — YYYY-MM-DD → UTC midnight Date. */
function parseDateOnly(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (value == null) {
        return null;
    }
    const raw = String(value).trim();
    if (!raw) {
        return null;
    }
    const ymd = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        return null;
    }
    const parsed = new Date(`${ymd}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decimalToNumber(
    value: Prisma.Decimal | number | string | null | undefined
): number | null {
    if (value == null) {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value);
}

const CLAIM_DETAIL_INCLUDE = {
    Invoice: {
        select: {
            id: true,
            invoice_number: true,
            invoice_date: true,
            outstanding_debt: true,
            status: true,
            reporting_breach: true,
            customer_id: true,
        },
    },
    Customer: {
        select: {
            id: true,
            customer_number: true,
            Company: { select: { name: true } },
            Person: {
                select: { first_name: true, last_name: true },
            },
        },
    },
    InsurancePolicy: {
        select: {
            id: true,
            policy_number: true,
            policy_kind: true,
            start_date: true,
            end_date: true,
            insured_percentage: true,
            non_qualifying_loss_threshold: true,
            aggregate_excess: true,
            sdl_excess: true,
        },
    },
} as const;

@Injectable()
export class ClaimsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    private async resolveAccountContext(user: JwtPayload): Promise<{
        accountId: number;
        userId: string;
    }> {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { has_credit_insurance: true },
        });
        if (!account?.has_credit_insurance) {
            throw new ForbiddenException({
                error: "Credit insurance is not enabled for this account",
            });
        }
        return { accountId, userId: userInfo.userId };
    }

    async list(user: JwtPayload, query: ClaimsListQuery) {
        const { accountId } = await this.resolveAccountContext(user);
        const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
        const limit = Math.min(
            200,
            Math.max(1, parseInt(query.limit || "50", 10) || 50)
        );

        const where: Prisma.ClaimWhereInput = { account_id: accountId };
        if (query.status) {
            if (!isClaimStatus(query.status)) {
                throw new BadRequestException({
                    error: `status must be one of: ${CLAIM_STATUSES.join(", ")}`,
                });
            }
            where.status = query.status;
        } else if (
            query.open_only === "true" ||
            query.open_only === "1"
        ) {
            where.status = {
                notIn: ["Paid", "Rejected", "Canceled"],
            };
        }
        if (query.customer_id) {
            const customerId = parseInt(query.customer_id, 10);
            if (!Number.isFinite(customerId)) {
                throw new BadRequestException({
                    error: "customer_id must be a number",
                });
            }
            where.customer_id = customerId;
        }
        if (
            query.unpaid_invoice_only === "true" ||
            query.unpaid_invoice_only === "1"
        ) {
            where.invoice_id = { not: null };
            where.Invoice = {
                status: { in: [...UNPAID_INVOICE_STATUSES_FOR_CLAIMS] },
            };
        }
        if (query.insurance_policy_id) {
            const policyId = parseInt(query.insurance_policy_id, 10);
            if (!Number.isFinite(policyId)) {
                throw new BadRequestException({
                    error: "insurance_policy_id must be a number",
                });
            }
            where.insurance_policy_id = policyId;
        }
        if (query.policy_year) {
            const year = parseInt(query.policy_year, 10);
            if (!Number.isFinite(year)) {
                throw new BadRequestException({
                    error: "policy_year must be a number",
                });
            }
            where.policy_year = year;
        }

        const [claims, totalRecords] = await Promise.all([
            this.db.claim.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { id: "desc" },
                include: CLAIM_DETAIL_INCLUDE,
            }),
            this.db.claim.count({ where }),
        ]);

        return serializeBigInt({ claims, totalRecords, page, limit });
    }

    async getById(user: JwtPayload, id: number) {
        const { accountId } = await this.resolveAccountContext(user);
        const claim = await this.db.claim.findFirst({
            where: { id, account_id: accountId },
            include: CLAIM_DETAIL_INCLUDE,
        });
        if (!claim) {
            throw new NotFoundException({ error: "Claim not found" });
        }
        return serializeBigInt(claim);
    }

    async create(user: JwtPayload, body: Record<string, unknown>) {
        const { accountId, userId } = await this.resolveAccountContext(user);

        const invoiceId = this.parseOptionalInt(body.invoice_id, "invoice_id");
        const customerIdInput = this.parseOptionalInt(
            body.customer_id,
            "customer_id"
        );

        let invoice: {
            id: number;
            account_id: number;
            customer_id: number | null;
            invoice_date: Date;
            outstanding_debt: number | null;
            status: string;
            reporting_breach: boolean;
            policy_id: number | null;
        } | null = null;

        if (invoiceId != null) {
            invoice = await this.db.invoice.findFirst({
                where: { id: invoiceId, account_id: accountId },
                select: {
                    id: true,
                    account_id: true,
                    customer_id: true,
                    invoice_date: true,
                    outstanding_debt: true,
                    status: true,
                    reporting_breach: true,
                    policy_id: true,
                },
            });
            if (!invoice) {
                throw new BadRequestException({
                    error: "invoice_id not found for this account",
                });
            }
        }

        const status: ClaimStatus =
            normalizeClaimStatus(body.status) ?? "Draft";

        const submissionDate = parseDateOnly(body.submission_date);
        const insurerRef =
            body.insurer_submission_reference == null
                ? null
                : String(body.insurer_submission_reference).trim() || null;

        try {
            assertSubmittedRequirements(status, {
                submissionDate,
                insurerSubmissionReference: insurerRef,
            });
        } catch (err) {
            throw new BadRequestException({
                error: err instanceof Error ? err.message : String(err),
            });
        }

        const explicitLossDate = parseDateOnly(body.loss_date);
        if (requiresLossDate(status) && !explicitLossDate) {
            throw new BadRequestException({
                error: "loss_date is required when status is Rejected",
            });
        }

        const lossDate =
            explicitLossDate ??
            (invoice ? invoice.invoice_date : null) ??
            submissionDate ??
            new Date();

        const policy = await this.resolvePrimaryPolicy({
            accountId,
            preferredPolicyId: invoice?.policy_id ?? null,
            asOfDate: lossDate,
            explicitPolicyId: this.parseOptionalInt(
                body.insurance_policy_id,
                "insurance_policy_id"
            ),
        });

        const year = resolvePolicyAnniversaryYear({
            policyStartDate: policy.start_date,
            policyEndDate: policy.end_date,
            asOfDate: lossDate,
        });
        if (!year) {
            throw new BadRequestException({
                error: "Claim date is outside the Primary policy term",
            });
        }

        if (invoice && invoiceId != null) {
            const existing = await this.db.claim.findUnique({
                where: { invoice_id: invoiceId },
                select: { id: true },
            });
            const requireEligibility =
                body.require_eligibility === true ||
                body.require_eligibility === "true" ||
                body.require_eligibility === 1;
            if (requireEligibility) {
                const eligibility = evaluateClaimEligibility({
                    openAmount: Number(invoice.outstanding_debt ?? 0),
                    nql: decimalToNumber(policy.non_qualifying_loss_threshold),
                    invoiceStatus: invoice.status,
                    reportingBreach: invoice.reporting_breach,
                    existingClaimForInvoice: existing != null,
                });
                if (!eligibility.eligible) {
                    throw new BadRequestException({
                        error: "Invoice is not eligible for Issue Claim",
                        code: "claim_not_eligible",
                        reasons: eligibility.reasons,
                        claim_id: existing?.id ?? null,
                    });
                }
            } else if (existing) {
                throw new BadRequestException({
                    error: "A claim already exists for this invoice",
                    code: "claim_already_exists",
                    claim_id: existing.id,
                });
            }
        }

        let recognizedLoss: number;
        if (body.recognized_loss != null && body.recognized_loss !== "") {
            recognizedLoss = this.parseRequiredMoney(
                body.recognized_loss,
                "recognized_loss"
            );
        } else if (invoice) {
            recognizedLoss = defaultRecognizedLoss(
                Number(invoice.outstanding_debt ?? 0),
                decimalToNumber(policy.insured_percentage)
            );
        } else {
            throw new BadRequestException({
                error: "recognized_loss is required when invoice_id is not set",
            });
        }

        const customerId =
            customerIdInput ?? invoice?.customer_id ?? null;
        if (customerId == null) {
            throw new BadRequestException({
                error: "customer_id is required",
            });
        }
        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: { id: true },
        });
        if (!customer) {
            throw new BadRequestException({
                error: "customer_id not found for this account",
            });
        }

        let excessFields: {
            excess_applied: boolean;
            applied_sdl_excess: Prisma.Decimal | null;
            applied_aggregate_excess: Prisma.Decimal | null;
        } = {
            excess_applied: false,
            applied_sdl_excess: null,
            applied_aggregate_excess: null,
        };

        if (
            (CLAIM_STATUSES_WITH_EXCESS as readonly string[]).includes(status)
        ) {
            excessFields = await this.computeExcessApplyFields({
                policy,
                policyYear: year.yearIndex,
                recognizedLoss,
                excludeClaimId: null,
            });
        }

        try {
            const created = await this.db.claim.create({
                data: {
                    account_id: accountId,
                    insurance_policy_id: policy.id,
                    invoice_id: invoiceId,
                    customer_id: customerId,
                    status: toDbClaimStatus(status) as ClaimStatus,
                    recognized_loss: toDecimal(recognizedLoss),
                    loss_date: explicitLossDate ?? (invoice ? null : lossDate),
                    policy_year: year.yearIndex,
                    submission_date: submissionDate,
                    insurer_submission_reference: insurerRef,
                    notes:
                        body.notes == null
                            ? null
                            : String(body.notes).trim() || null,
                    created_by: userId,
                    modified_by: userId,
                    ...excessFields,
                },
                include: CLAIM_DETAIL_INCLUDE,
            });
            return serializeBigInt(created);
        } catch (err) {
            if (
                err instanceof Prisma.PrismaClientKnownRequestError &&
                err.code === "P2002"
            ) {
                throw new BadRequestException({
                    error: "A claim already exists for this invoice",
                    code: "claim_already_exists",
                });
            }
            throw err;
        }
    }

    async update(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const { accountId, userId } = await this.resolveAccountContext(user);
        const existing = await this.db.claim.findFirst({
            where: { id, account_id: accountId },
        });
        if (!existing) {
            throw new NotFoundException({ error: "Claim not found" });
        }

        const previousStatus =
            normalizeClaimStatus(existing.status) ?? "Draft";
        let nextStatus: ClaimStatus = previousStatus;
        if (body.status != null) {
            const normalized = normalizeClaimStatus(body.status);
            if (!normalized) {
                throw new BadRequestException({
                    error: `status must be one of: ${CLAIM_STATUSES.join(", ")}`,
                });
            }
            nextStatus = normalized;
        }

        const submissionDate =
            "submission_date" in body
                ? parseDateOnly(body.submission_date)
                : existing.submission_date;
        const insurerRef =
            "insurer_submission_reference" in body
                ? body.insurer_submission_reference == null
                    ? null
                    : String(body.insurer_submission_reference).trim() || null
                : existing.insurer_submission_reference;

        try {
            assertSubmittedRequirements(nextStatus, {
                submissionDate,
                insurerSubmissionReference: insurerRef,
            });
        } catch (err) {
            throw new BadRequestException({
                error: err instanceof Error ? err.message : String(err),
            });
        }

        const nextLossDate =
            "loss_date" in body
                ? parseDateOnly(body.loss_date)
                : existing.loss_date;
        if (requiresLossDate(nextStatus) && !nextLossDate) {
            throw new BadRequestException({
                error: "loss_date is required when status is Rejected",
            });
        }

        let recognizedLoss = decimalToNumber(existing.recognized_loss) ?? 0;
        if ("recognized_loss" in body) {
            recognizedLoss = this.parseRequiredMoney(
                body.recognized_loss,
                "recognized_loss"
            );
        }

        const data: Prisma.ClaimUncheckedUpdateInput = {
            modified_by: userId,
            status: toDbClaimStatus(nextStatus) as ClaimStatus,
            submission_date: submissionDate,
            insurer_submission_reference: insurerRef,
            recognized_loss: toDecimal(recognizedLoss),
        };

        if ("notes" in body) {
            data.notes =
                body.notes == null ? null : String(body.notes).trim() || null;
        }

        if ("loss_date" in body) {
            const lossDate = parseDateOnly(body.loss_date);
            if (body.loss_date != null && body.loss_date !== "" && !lossDate) {
                throw new BadRequestException({
                    error: "loss_date must be YYYY-MM-DD",
                });
            }
            if (lossDate) {
                data.loss_date = lossDate;
                const policy = await this.db.insurancePolicy.findFirstOrThrow({
                    where: {
                        id: existing.insurance_policy_id,
                        account_id: accountId,
                    },
                });
                const year = resolvePolicyAnniversaryYear({
                    policyStartDate: policy.start_date,
                    policyEndDate: policy.end_date,
                    asOfDate: lossDate,
                });
                if (!year) {
                    throw new BadRequestException({
                        error: "Claim date is outside the Primary policy term",
                    });
                }
                data.policy_year = year.yearIndex;
            } else if (existing.invoice_id == null && !requiresLossDate(nextStatus)) {
                data.loss_date = null;
            }
        }

        const alreadyApplied = existing.excess_applied;
        if (
            shouldApplyExcessOnTransition(
                previousStatus,
                nextStatus,
                alreadyApplied
            )
        ) {
            const policy = await this.db.insurancePolicy.findFirstOrThrow({
                where: {
                    id: existing.insurance_policy_id,
                    account_id: accountId,
                },
            });
            const excess = await this.computeExcessApplyFields({
                policy,
                policyYear: existing.policy_year,
                recognizedLoss,
                excludeClaimId: existing.id,
            });
            Object.assign(data, excess);
        } else if (
            shouldReverseExcessOnTransition(
                previousStatus,
                nextStatus,
                alreadyApplied
            )
        ) {
            data.excess_applied = false;
            data.applied_sdl_excess = null;
            data.applied_aggregate_excess = null;
        }

        const updated = await this.db.claim.update({
            where: { id: existing.id },
            data,
            include: CLAIM_DETAIL_INCLUDE,
        });
        return serializeBigInt(updated);
    }

    /**
     * Remaining Aggregate/SDL excess for a Primary policy year after applied claims.
     */
    async remainingExcess(
        user: JwtPayload,
        query: {
            insurance_policy_id?: string;
            policy_year?: string;
        }
    ) {
        const { accountId } = await this.resolveAccountContext(user);
        const policyId = parseInt(query.insurance_policy_id || "", 10);
        const policyYear = parseInt(query.policy_year || "", 10);
        if (!Number.isFinite(policyId) || !Number.isFinite(policyYear)) {
            throw new BadRequestException({
                error: "insurance_policy_id and policy_year are required numbers",
            });
        }

        const policy = await this.loadPrimaryPolicyForExcess(
            accountId,
            policyId
        );
        const years = listPolicyAnniversaryYears({
            policyStartDate: policy.start_date,
            policyEndDate: policy.end_date,
        });
        const yearWindow = years.find((y) => y.yearIndex === policyYear) ?? null;
        if (!yearWindow) {
            throw new BadRequestException({
                error: `policy_year ${policyYear} is outside the Primary policy term`,
            });
        }

        const row = await this.buildRemainingExcessYearRow({
            policy,
            yearWindow,
        });
        return serializeBigInt(row);
    }

    /**
     * Remaining Aggregate/SDL excess for Primary anniversary years, optionally
     * limited to the current year + prior (recent_years − 1), with claims.
     * Used by Primary policy settings and Portfolio Health policy summary.
     */
    async policyExcessSummary(
        user: JwtPayload,
        query: {
            insurance_policy_id?: string;
            recent_years?: string;
            include_claims?: string;
            as_of?: string;
        }
    ) {
        const { accountId } = await this.resolveAccountContext(user);
        const policyId = parseInt(query.insurance_policy_id || "", 10);
        if (!Number.isFinite(policyId)) {
            throw new BadRequestException({
                error: "insurance_policy_id is required",
            });
        }

        const includeClaims =
            query.include_claims === "1" ||
            query.include_claims === "true" ||
            query.include_claims === undefined;

        let recentYears: number | null = null;
        if (query.recent_years != null && String(query.recent_years).trim()) {
            recentYears = parseInt(query.recent_years, 10);
            if (!Number.isFinite(recentYears) || recentYears < 1) {
                throw new BadRequestException({
                    error: "recent_years must be a positive number",
                });
            }
        }

        const asOf =
            parseDateOnly(query.as_of) ??
            parseDateOnly(new Date().toISOString().slice(0, 10))!;

        const policy = await this.loadPrimaryPolicyForExcess(
            accountId,
            policyId
        );
        const allYears = listPolicyAnniversaryYears({
            policyStartDate: policy.start_date,
            policyEndDate: policy.end_date,
        });

        let selectedYears = allYears;
        if (recentYears != null) {
            const current = resolvePolicyAnniversaryYear({
                policyStartDate: policy.start_date,
                policyEndDate: policy.end_date,
                asOfDate: asOf,
            });
            if (current) {
                const minYear = Math.max(
                    1,
                    current.yearIndex - recentYears + 1
                );
                selectedYears = allYears.filter(
                    (y) =>
                        y.yearIndex >= minYear &&
                        y.yearIndex <= current.yearIndex
                );
            } else {
                selectedYears = allYears.slice(-recentYears);
            }
        }

        const yearIndexes = selectedYears.map((y) => y.yearIndex);
        const claimsByYear = new Map<
            number,
            Array<Record<string, unknown>>
        >();
        if (includeClaims && yearIndexes.length > 0) {
            const claims = await this.db.claim.findMany({
                where: {
                    account_id: accountId,
                    insurance_policy_id: policy.id,
                    policy_year: { in: yearIndexes },
                },
                orderBy: [{ policy_year: "desc" }, { id: "desc" }],
                include: CLAIM_DETAIL_INCLUDE,
            });
            for (const claim of claims) {
                const list = claimsByYear.get(claim.policy_year) ?? [];
                list.push(claim as unknown as Record<string, unknown>);
                claimsByYear.set(claim.policy_year, list);
            }
        }

        const years = [];
        for (const yearWindow of selectedYears) {
            const excess = await this.buildRemainingExcessYearRow({
                policy,
                yearWindow,
            });
            years.push({
                ...excess,
                claims: includeClaims
                    ? (claimsByYear.get(yearWindow.yearIndex) ?? [])
                    : undefined,
            });
        }

        // Newest anniversary year first for summary UIs.
        years.reverse();

        return serializeBigInt({
            insurance_policy_id: policy.id,
            as_of: asOf,
            aggregate_excess: decimalToNumber(policy.aggregate_excess),
            sdl_excess: decimalToNumber(policy.sdl_excess),
            years,
        });
    }

    private async loadPrimaryPolicyForExcess(
        accountId: number,
        policyId: number
    ) {
        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: policyId, account_id: accountId },
        });
        if (!policy) {
            throw new NotFoundException({
                error: "Insurance policy not found",
            });
        }
        if (policy.policy_kind !== "Primary") {
            throw new BadRequestException({
                error: "Remaining excess is only available for Primary policies",
                code: "primary_only",
            });
        }
        return policy;
    }

    private async buildRemainingExcessYearRow(args: {
        policy: {
            id: number;
            sdl_excess: Prisma.Decimal | null;
            aggregate_excess: Prisma.Decimal | null;
        };
        yearWindow: {
            yearIndex: number;
            yearStart: Date;
            yearEnd: Date;
        };
    }) {
        const applied = await this.sumAppliedExcessForYear({
            insurancePolicyId: args.policy.id,
            policyYear: args.yearWindow.yearIndex,
            excludeClaimId: null,
        });

        const remaining = remainingExcessForPolicyYear({
            commercial: {
                sdlExcess: decimalToNumber(args.policy.sdl_excess),
                aggregateExcess: decimalToNumber(args.policy.aggregate_excess),
            },
            appliedSdlSum: applied.appliedSdl,
            appliedAggregateSum: applied.appliedAggregate,
        });

        return {
            insurance_policy_id: args.policy.id,
            policy_year: args.yearWindow.yearIndex,
            policy_year_start: args.yearWindow.yearStart,
            policy_year_end: args.yearWindow.yearEnd,
            aggregate_excess: decimalToNumber(args.policy.aggregate_excess),
            sdl_excess: decimalToNumber(args.policy.sdl_excess),
            applied_sdl_excess: applied.appliedSdl,
            applied_aggregate_excess: applied.appliedAggregate,
            remaining_sdl_excess: remaining.remainingSdl,
            remaining_aggregate_excess: remaining.remainingAggregate,
        };
    }

    /**
     * Domain eligibility check exposed for Issue Claim (slice 02) reuse.
     */
    async checkEligibilityForInvoice(user: JwtPayload, invoiceId: number) {
        const { accountId } = await this.resolveAccountContext(user);
        const invoice = await this.db.invoice.findFirst({
            where: { id: invoiceId, account_id: accountId },
            select: {
                id: true,
                outstanding_debt: true,
                status: true,
                reporting_breach: true,
                invoice_date: true,
                policy_id: true,
            },
        });
        if (!invoice) {
            throw new NotFoundException({ error: "Invoice not found" });
        }
        const existing = await this.db.claim.findUnique({
            where: { invoice_id: invoiceId },
            select: { id: true },
        });
        const policy = await this.resolvePrimaryPolicy({
            accountId,
            preferredPolicyId: invoice.policy_id,
            asOfDate: invoice.invoice_date,
            explicitPolicyId: null,
        });
        const result = evaluateClaimEligibility({
            openAmount: Number(invoice.outstanding_debt ?? 0),
            nql: decimalToNumber(policy.non_qualifying_loss_threshold),
            invoiceStatus: invoice.status,
            reportingBreach: invoice.reporting_breach,
            existingClaimForInvoice: existing != null,
        });
        return {
            ...result,
            claim_id: existing?.id ?? null,
            insurance_policy_id: policy.id,
            default_recognized_loss: defaultRecognizedLoss(
                Number(invoice.outstanding_debt ?? 0),
                decimalToNumber(policy.insured_percentage)
            ),
        };
    }

    private async resolvePrimaryPolicy(args: {
        accountId: number;
        preferredPolicyId: number | null;
        asOfDate: Date;
        explicitPolicyId: number | null;
    }) {
        if (args.explicitPolicyId != null) {
            const explicit = await this.db.insurancePolicy.findFirst({
                where: {
                    id: args.explicitPolicyId,
                    account_id: args.accountId,
                },
            });
            if (!explicit) {
                throw new BadRequestException({
                    error: "insurance_policy_id not found for this account",
                });
            }
            if (explicit.policy_kind !== "Primary") {
                throw new BadRequestException({
                    error: "Claims must be owned by a Primary insurance policy",
                    code: "primary_only",
                });
            }
            return explicit;
        }

        if (args.preferredPolicyId != null) {
            const preferred = await this.db.insurancePolicy.findFirst({
                where: {
                    id: args.preferredPolicyId,
                    account_id: args.accountId,
                    policy_kind: "Primary",
                },
            });
            if (preferred) {
                return preferred;
            }
        }

        const primaries = await this.db.insurancePolicy.findMany({
            where: {
                account_id: args.accountId,
                policy_kind: "Primary",
            },
            orderBy: [{ status: "asc" }, { start_date: "desc" }],
        });

        const covering = primaries.find(
            (p) =>
                resolvePolicyAnniversaryYear({
                    policyStartDate: p.start_date,
                    policyEndDate: p.end_date,
                    asOfDate: args.asOfDate,
                }) != null
        );
        if (covering) {
            return covering;
        }

        throw new BadRequestException({
            error: "No Primary insurance policy covers the claim date",
            code: "primary_required",
        });
    }

    private async sumAppliedExcessForYear(args: {
        insurancePolicyId: number;
        policyYear: number;
        excludeClaimId: number | null;
    }): Promise<{ appliedSdl: number; appliedAggregate: number }> {
        const rows = await this.db.claim.findMany({
            where: {
                insurance_policy_id: args.insurancePolicyId,
                policy_year: args.policyYear,
                excess_applied: true,
                ...(args.excludeClaimId != null
                    ? { id: { not: args.excludeClaimId } }
                    : {}),
            },
            select: {
                applied_sdl_excess: true,
                applied_aggregate_excess: true,
            },
        });
        let appliedSdl = 0;
        let appliedAggregate = 0;
        for (const row of rows) {
            appliedSdl += decimalToNumber(row.applied_sdl_excess) ?? 0;
            appliedAggregate +=
                decimalToNumber(row.applied_aggregate_excess) ?? 0;
        }
        return { appliedSdl, appliedAggregate };
    }

    private async computeExcessApplyFields(args: {
        policy: {
            id: number;
            sdl_excess: Prisma.Decimal | null;
            aggregate_excess: Prisma.Decimal | null;
        };
        policyYear: number;
        recognizedLoss: number;
        excludeClaimId: number | null;
    }) {
        const already = await this.sumAppliedExcessForYear({
            insurancePolicyId: args.policy.id,
            policyYear: args.policyYear,
            excludeClaimId: args.excludeClaimId,
        });
        const applied = applyClaimExcess({
            recognizedLoss: args.recognizedLoss,
            commercial: {
                sdlExcess: decimalToNumber(args.policy.sdl_excess),
                aggregateExcess: decimalToNumber(args.policy.aggregate_excess),
            },
            alreadyAppliedSdl: already.appliedSdl,
            alreadyAppliedAggregate: already.appliedAggregate,
        });
        return {
            excess_applied: true,
            applied_sdl_excess: toDecimal(applied.appliedSdl),
            applied_aggregate_excess: toDecimal(applied.appliedAggregate),
        };
    }

    private parseOptionalInt(
        value: unknown,
        fieldName: string
    ): number | null {
        if (value == null || value === "") {
            return null;
        }
        const n = typeof value === "number" ? value : parseInt(String(value), 10);
        if (!Number.isFinite(n)) {
            throw new BadRequestException({
                error: `${fieldName} must be a number`,
            });
        }
        return n;
    }

    private parseRequiredMoney(value: unknown, fieldName: string): number {
        if (value == null || value === "") {
            throw new BadRequestException({
                error: `${fieldName} is required`,
            });
        }
        const n = Number(String(value).trim().replace(",", "."));
        if (!Number.isFinite(n) || n < 0) {
            throw new BadRequestException({
                error: `${fieldName} must be a non-negative number`,
            });
        }
        return n;
    }
}
