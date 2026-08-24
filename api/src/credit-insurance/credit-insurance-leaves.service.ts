import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
    OnModuleInit,
} from "@nestjs/common";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import {
    CreditDashboardAccessService,
    CreditDashboardAccessContext,
} from "./credit-dashboard-access.service";
import { bindCreditInsurancePrisma } from "./domain-db";
import { getCreditDashboardSummaryHistory } from "./domain/creditDashboardSnapshotService";
import { getCreditPortfolioHealth } from "./domain/creditPortfolioHealthService";
import {
    getCustomerPolicyTrendForCustomer,
    getCustomerPolicyUsageTrend,
} from "./domain/customerPolicyTrendService";
import {
    getInsurancePolicyConfigChanges,
    getInsurancePolicyCountryTrend,
    getInsurancePolicyTrend,
    getNamedPolicyTrend,
} from "./domain/insurancePolicyTrendService";
import {
    CreditAsOfBackfillConflictError,
    getCreditAsOfBackfillJobStatus,
    pauseCreditAsOfBackfillJob,
    retryCreditAsOfBackfillJob,
    startCreditAsOfBackfillJob,
} from "./domain/creditAsOfBackfillJob";
import {
    getCapacityGapReport,
    getLimitWarningReport,
    getNoPolicyExposureReport,
    getOverdueBlockReport,
    getPolicyRiskExposureReport,
    getReportedInvoicesReport,
    getReportingCountdownOpenReport,
    getTermsBreachReport,
    getZeroLimitWarningReport,
    isTermsBreachReasonFilter,
    type CreditReportListOptions,
} from "./domain/creditInsuranceDashboardService";
import {
    getTopUpCoverReport,
    getTopUpExpiringReport,
} from "./domain/creditInsuranceTopUpDashboardService";
import { hasTopUpPolicies } from "./domain/hasTopUpPolicies";

const REPORT_TYPES = [
    "overdue",
    "capacity",
    "terms",
    "policy_risk",
    "reporting",
    "reported",
    "limit_warning",
    "zero_limit_warning",
    "top_up",
    "top_up_expiring",
    "no_policy_exposure",
] as const;
type ReportType = (typeof REPORT_TYPES)[number];

@Injectable()
export class CreditInsuranceLeavesService implements OnModuleInit {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: CreditDashboardAccessService
    ) {}

    onModuleInit() {
        bindCreditInsurancePrisma(this.db);
    }

    async summaryHistory(user: JwtPayload, query: Record<string, unknown>) {
        const ctx = await this.access.authorize(user, query);
        const policyId = this.parseOptionalPolicyId(query.policyId);
        await this.assertPolicyInAccount(ctx.accountId, policyId);

        const days = this.parseDays(query.days, 30);
        const interval =
            String(query.interval || "daily") === "weekly" ? "weekly" : "daily";

        const history = await getCreditDashboardSummaryHistory(
            ctx.accountId,
            days,
            policyId,
            interval,
            {
                isAdmin: ctx.isAdmin,
                selectedBusinessUnitId: ctx.selectedBusinessUnitId,
                accessibleBusinessUnitIds: ctx.accessibleBusinessUnitIds,
            }
        );
        return serializeBigInt(history);
    }

    async portfolioHealth(user: JwtPayload, query: Record<string, unknown>) {
        const ctx = await this.access.authorize(user, query);
        const policyId = this.parseOptionalPolicyId(query.policyId);
        await this.assertPolicyInAccount(ctx.accountId, policyId);

        const result = await getCreditPortfolioHealth(ctx.accountId, {
            from: this.parseOptionalDate(query.from) ?? "",
            to: this.parseOptionalDate(query.to) ?? "",
            policyId,
            businessUnitFilter: ctx.businessUnitFilter as never,
            includeNoPolicyExposure: this.parseIncludeNoPolicyExposure(
                query.includeNoPolicyExposure
            ),
            selectedBusinessUnitId: ctx.selectedBusinessUnitId,
            accessibleBusinessUnitIds: ctx.accessibleBusinessUnitIds,
            isAdmin: ctx.isAdmin,
        });

        if (result && typeof result === "object" && "error" in result) {
            throw new BadRequestException({ error: result.error });
        }
        return serializeBigInt(result);
    }

    async customerPolicyTrend(
        user: JwtPayload,
        query: Record<string, unknown>
    ) {
        const ctx = await this.access.authorize(user, query);
        const policyId = this.parseOptionalPolicyId(query.policyId);
        await this.assertPolicyInAccount(ctx.accountId, policyId);

        const customerId = this.parseOptionalPositiveInt(query.customerId);
        const days = this.parseOptionalPositiveInt(query.days);

        const data =
            customerId != null
                ? await getCustomerPolicyTrendForCustomer(
                      ctx.accountId,
                      customerId,
                      { policyId, days }
                  )
                : await getCustomerPolicyUsageTrend(ctx.accountId, {
                      policyId,
                      limit: this.parseOptionalPositiveInt(query.limit) ?? 10,
                      businessUnitFilter: ctx.businessUnitFilter as never,
                  });

        return serializeBigInt(data);
    }

    async insurancePolicyTrend(
        user: JwtPayload,
        query: Record<string, unknown>
    ) {
        const ctx = await this.access.authorize(
            user,
            query,
            "insurance-policy-trend"
        );
        const policyId = this.parseOptionalPolicyId(query.policyId);
        if (policyId == null) {
            throw new BadRequestException({ error: "policyId is required" });
        }
        await this.assertPolicyInAccount(ctx.accountId, policyId);

        const scope = this.parseTrendScope(query.scope);
        const days = this.parseOptionalPositiveInt(query.days);

        if (scope === "countries") {
            return serializeBigInt(
                await getInsurancePolicyCountryTrend(ctx.accountId, policyId, {
                    countryId: this.parseOptionalPositiveInt(query.countryId),
                    days,
                })
            );
        }
        if (scope === "named") {
            return serializeBigInt(
                await getNamedPolicyTrend(ctx.accountId, policyId, {
                    namedPolicyId: this.parseOptionalPositiveInt(
                        query.namedPolicyId
                    ),
                    customerNumber: this.parseOptionalString(
                        query.customerNumber
                    ),
                    days,
                })
            );
        }
        if (scope === "changes") {
            return serializeBigInt(
                await getInsurancePolicyConfigChanges(ctx.accountId, policyId, {
                    fromDate: this.parseOptionalString(query.fromDate),
                    toDate: this.parseOptionalString(query.toDate),
                })
            );
        }

        return serializeBigInt(
            await getInsurancePolicyTrend(ctx.accountId, policyId, { days })
        );
    }

    async report(user: JwtPayload, query: Record<string, unknown>) {
        const ctx = await this.access.authorize(user, query);
        const type = this.parseReportType(query.type);
        if (!type) {
            throw new BadRequestException({
                error: "type is required and must be a known report type",
            });
        }

        const policyId = this.parseOptionalPolicyId(query.policyId);
        await this.assertPolicyInAccount(ctx.accountId, policyId);
        const customerId = this.parseOptionalPositiveInt(query.customerId);
        if (customerId != null) {
            const customerOk = await this.db.customer.count({
                where: { id: customerId, account_id: ctx.accountId },
            });
            if (customerOk === 0) {
                throw new NotFoundException({ error: "Customer not found" });
            }
        }

        const termsBreachReason = this.parseTermsBreachReason(
            query.termsBreachReason
        );
        const termsOverdueOnly = this.parseTruthy(query.termsOverdueOnly);
        if (
            (termsBreachReason != null || termsOverdueOnly) &&
            type !== "terms"
        ) {
            throw new BadRequestException({
                error: "termsBreachReason/termsOverdueOnly only allowed for type=terms",
            });
        }

        if (type === "top_up" || type === "top_up_expiring") {
            const has = await hasTopUpPolicies(ctx.accountId);
            if (!has) {
                throw new NotFoundException({
                    error: "No top-up policies for this account",
                });
            }
        }

        const listOptions: CreditReportListOptions = {
            query: this.parseOptionalString(query.query),
            sortField: this.parseOptionalString(query.sortField),
            sortDirection:
                String(query.sortDirection || "asc").toLowerCase() === "desc"
                    ? "desc"
                    : "asc",
            policyId,
            customerId,
            termsBreachReason,
            termsOverdueOnly,
            withinDays: this.parseIntParam(query.withinDays, 30, 365),
            includeNoPolicyExposure: this.parseIncludeNoPolicyExposure(
                query.includeNoPolicyExposure
            ),
            businessUnitFilter: ctx.businessUnitFilter as never,
        };

        const page = this.parsePage(query.page);
        const limit = this.parseIntParam(query.limit, 20, 10_000);
        const skip = (page - 1) * limit;

        const account = await this.db.account.findUnique({
            where: { id: ctx.accountId },
            select: { reporting_date_warning_days: true },
        });
        const reportingWindowDays = Math.max(
            0,
            account?.reporting_date_warning_days ?? 14
        );

        const { total, rows } = await this.runReport(
            ctx,
            type,
            limit,
            skip,
            listOptions,
            reportingWindowDays
        );

        const data = rows.map((row, index) => {
            const r = row as { customerId: number; invoiceId?: number };
            const id =
                (type === "terms" ||
                    type === "reporting" ||
                    type === "reported") &&
                r.invoiceId != null
                    ? r.invoiceId
                    : type === "top_up_expiring"
                      ? r.customerId * 1_000_000 + index
                      : r.customerId;
            return { ...row, id };
        });

        return serializeBigInt({ data, totalRecords: total });
    }

    private async runReport(
        ctx: CreditDashboardAccessContext,
        type: ReportType,
        take: number,
        skip: number,
        options: CreditReportListOptions,
        reportingWindowDays: number
    ): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
        switch (type) {
            case "overdue":
                return getOverdueBlockReport(
                    ctx.accountId,
                    take,
                    skip,
                    options
                );
            case "capacity":
                return getCapacityGapReport(
                    ctx.accountId,
                    take,
                    skip,
                    options
                );
            case "terms":
                return getTermsBreachReport(
                    ctx.accountId,
                    take,
                    skip,
                    options
                );
            case "policy_risk":
                return getPolicyRiskExposureReport(
                    ctx.accountId,
                    take,
                    skip,
                    options
                );
            case "reporting":
                return getReportingCountdownOpenReport(
                    ctx.accountId,
                    take,
                    skip,
                    reportingWindowDays,
                    options
                );
            case "reported":
                return getReportedInvoicesReport(
                    ctx.accountId,
                    take,
                    skip,
                    options
                );
            case "limit_warning":
                return getLimitWarningReport(
                    ctx.accountId,
                    take,
                    skip,
                    options
                );
            case "zero_limit_warning":
                return getZeroLimitWarningReport(
                    ctx.accountId,
                    take,
                    skip,
                    options
                );
            case "top_up":
                return getTopUpCoverReport(
                    ctx.accountId,
                    take,
                    skip,
                    options
                );
            case "top_up_expiring":
                return getTopUpExpiringReport(
                    ctx.accountId,
                    take,
                    skip,
                    options
                );
            case "no_policy_exposure":
                return getNoPolicyExposureReport(
                    ctx.accountId,
                    take,
                    skip,
                    options
                );
            default:
                throw new BadRequestException({ error: "Unknown report type" });
        }
    }

    private async assertPolicyInAccount(
        accountId: number,
        policyId: number | undefined
    ) {
        if (policyId == null) return;
        const policyOk = await this.db.insurancePolicy.count({
            where: { id: policyId, account_id: accountId },
        });
        if (policyOk === 0) {
            throw new NotFoundException({ error: "Policy not found" });
        }
    }

    private parseOptionalPolicyId(raw: unknown): number | undefined {
        return this.parseOptionalPositiveInt(raw);
    }

    private parseOptionalPositiveInt(raw: unknown): number | undefined {
        if (raw == null || String(raw).trim() === "") return undefined;
        const n = Number.parseInt(String(Array.isArray(raw) ? raw[0] : raw), 10);
        if (!Number.isFinite(n) || n < 1) return undefined;
        return n;
    }

    private parseOptionalString(raw: unknown): string | undefined {
        if (raw == null) return undefined;
        const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
        return s === "" ? undefined : s;
    }

    private parseOptionalDate(raw: unknown): string | undefined {
        return this.parseOptionalString(raw);
    }

    private parseDays(raw: unknown, fallback: number): number {
        const n = this.parseOptionalPositiveInt(raw);
        if (n == null) return fallback;
        return Math.min(365, Math.max(2, n));
    }

    private parseIntParam(raw: unknown, fallback: number, max: number): number {
        if (raw == null || String(raw).trim() === "") return fallback;
        const n = Number.parseInt(String(Array.isArray(raw) ? raw[0] : raw), 10);
        if (!Number.isFinite(n) || n < 0) return fallback;
        return Math.min(n, max);
    }

    private parsePage(raw: unknown): number {
        const n = this.parseIntParam(raw, 1, 1_000_000);
        return n < 1 ? 1 : n;
    }

    private parseIncludeNoPolicyExposure(raw: unknown): boolean {
        if (raw == null) return true;
        const v = String(Array.isArray(raw) ? raw[0] : raw)
            .trim()
            .toLowerCase();
        return !(v === "0" || v === "false" || v === "no");
    }

    private parseTruthy(raw: unknown): boolean {
        if (raw == null) return false;
        const v = String(Array.isArray(raw) ? raw[0] : raw)
            .trim()
            .toLowerCase();
        return v === "1" || v === "true" || v === "yes";
    }

    private parseTrendScope(
        raw: unknown
    ): "header" | "countries" | "named" | "changes" {
        const s = this.parseOptionalString(raw)?.toLowerCase();
        if (s === "countries" || s === "named" || s === "changes") return s;
        return "header";
    }

    private parseReportType(raw: unknown): ReportType | null {
        const t = this.parseOptionalString(raw);
        if (!t || !REPORT_TYPES.includes(t as ReportType)) return null;
        return t as ReportType;
    }

    private parseTermsBreachReason(
        raw: unknown
    ): CreditReportListOptions["termsBreachReason"] {
        const code = this.parseOptionalString(raw);
        if (!code || !isTermsBreachReasonFilter(code)) return undefined;
        return code;
    }

    async asOfBackfillStatus(user: JwtPayload, query: Record<string, unknown>) {
        const ctx = await this.access.authorize(user, query);
        const status = await getCreditAsOfBackfillJobStatus(ctx.accountId);
        return serializeBigInt(status);
    }

    async asOfBackfillStart(
        user: JwtPayload,
        query: Record<string, unknown>,
        body: Record<string, unknown>
    ) {
        const ctx = await this.access.authorize(user, query);
        const from = this.parseRequiredYmd(body.from ?? body.fromDate, "from");
        const to = this.parseRequiredYmd(body.to ?? body.toDate, "to");
        try {
            const status = await startCreditAsOfBackfillJob(
                ctx.accountId,
                from,
                to,
                {
                    requestedBy: user.sub ?? user.email ?? null,
                    skipReportingBreach: this.parseSkipReportingBreach(
                        body.skipReportingBreach
                    ),
                }
            );
            return serializeBigInt(status);
        } catch (error) {
            if (error instanceof CreditAsOfBackfillConflictError) {
                throw new ConflictException({ error: error.message });
            }
            if (error instanceof Error) {
                throw new BadRequestException({ error: error.message });
            }
            throw error;
        }
    }

    async asOfBackfillPause(user: JwtPayload, query: Record<string, unknown>) {
        const ctx = await this.access.authorize(user, query);
        const status = await pauseCreditAsOfBackfillJob(ctx.accountId);
        return serializeBigInt(status);
    }

    async asOfBackfillRetry(user: JwtPayload, query: Record<string, unknown>) {
        const ctx = await this.access.authorize(user, query);
        try {
            const status = await retryCreditAsOfBackfillJob(ctx.accountId);
            return serializeBigInt(status);
        } catch (error) {
            if (error instanceof CreditAsOfBackfillConflictError) {
                throw new ConflictException({ error: error.message });
            }
            if (error instanceof Error) {
                throw new BadRequestException({ error: error.message });
            }
            throw error;
        }
    }

    private parseRequiredYmd(raw: unknown, field: string): Date {
        const s = this.parseOptionalString(raw);
        if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            throw new BadRequestException({
                error: `${field} must be YYYY-MM-DD`,
            });
        }
        const [y, m, d] = s.split("-").map(Number);
        return new Date(Date.UTC(y!, m! - 1, d!));
    }

    /** Omitted / invalid → true (Generate default: ignore reporting-late). */
    private parseSkipReportingBreach(raw: unknown): boolean {
        if (raw === false || raw === "false" || raw === 0 || raw === "0") {
            return false;
        }
        return true;
    }
}
