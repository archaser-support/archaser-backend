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
exports.CreditInsuranceLeavesService = void 0;
const common_1 = require("@nestjs/common");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const credit_dashboard_access_service_1 = require("./credit-dashboard-access.service");
const domain_db_1 = require("./domain-db");
const creditDashboardSnapshotService_1 = require("./domain/creditDashboardSnapshotService");
const creditPortfolioHealthService_1 = require("./domain/creditPortfolioHealthService");
const customerPolicyTrendService_1 = require("./domain/customerPolicyTrendService");
const insurancePolicyTrendService_1 = require("./domain/insurancePolicyTrendService");
const creditInsuranceDashboardService_1 = require("./domain/creditInsuranceDashboardService");
const creditInsuranceTopUpDashboardService_1 = require("./domain/creditInsuranceTopUpDashboardService");
const hasTopUpPolicies_1 = require("./domain/hasTopUpPolicies");
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
];
let CreditInsuranceLeavesService = class CreditInsuranceLeavesService {
    constructor(db, access) {
        this.db = db;
        this.access = access;
    }
    onModuleInit() {
        (0, domain_db_1.bindCreditInsurancePrisma)(this.db);
    }
    async summaryHistory(user, query) {
        const ctx = await this.access.authorize(user, query);
        const policyId = this.parseOptionalPolicyId(query.policyId);
        await this.assertPolicyInAccount(ctx.accountId, policyId);
        const days = this.parseDays(query.days, 30);
        const interval = String(query.interval || "daily") === "weekly" ? "weekly" : "daily";
        const history = await (0, creditDashboardSnapshotService_1.getCreditDashboardSummaryHistory)(ctx.accountId, days, policyId, interval, {
            isAdmin: ctx.isAdmin,
            selectedBusinessUnitId: ctx.selectedBusinessUnitId,
            accessibleBusinessUnitIds: ctx.accessibleBusinessUnitIds,
        });
        return (0, serialize_bigint_1.serializeBigInt)(history);
    }
    async portfolioHealth(user, query) {
        const ctx = await this.access.authorize(user, query);
        const policyId = this.parseOptionalPolicyId(query.policyId);
        await this.assertPolicyInAccount(ctx.accountId, policyId);
        const result = await (0, creditPortfolioHealthService_1.getCreditPortfolioHealth)(ctx.accountId, {
            from: this.parseOptionalDate(query.from) ?? "",
            to: this.parseOptionalDate(query.to) ?? "",
            policyId,
            businessUnitFilter: ctx.businessUnitFilter,
            includeNoPolicyExposure: this.parseIncludeNoPolicyExposure(query.includeNoPolicyExposure),
            selectedBusinessUnitId: ctx.selectedBusinessUnitId,
            accessibleBusinessUnitIds: ctx.accessibleBusinessUnitIds,
            isAdmin: ctx.isAdmin,
        });
        if (result && typeof result === "object" && "error" in result) {
            throw new common_1.BadRequestException({ error: result.error });
        }
        return (0, serialize_bigint_1.serializeBigInt)(result);
    }
    async customerPolicyTrend(user, query) {
        const ctx = await this.access.authorize(user, query);
        const policyId = this.parseOptionalPolicyId(query.policyId);
        await this.assertPolicyInAccount(ctx.accountId, policyId);
        const customerId = this.parseOptionalPositiveInt(query.customerId);
        const days = this.parseOptionalPositiveInt(query.days);
        const data = customerId != null
            ? await (0, customerPolicyTrendService_1.getCustomerPolicyTrendForCustomer)(ctx.accountId, customerId, { policyId, days })
            : await (0, customerPolicyTrendService_1.getCustomerPolicyUsageTrend)(ctx.accountId, {
                policyId,
                limit: this.parseOptionalPositiveInt(query.limit) ?? 10,
                businessUnitFilter: ctx.businessUnitFilter,
            });
        return (0, serialize_bigint_1.serializeBigInt)(data);
    }
    async insurancePolicyTrend(user, query) {
        const ctx = await this.access.authorize(user, query, "insurance-policy-trend");
        const policyId = this.parseOptionalPolicyId(query.policyId);
        if (policyId == null) {
            throw new common_1.BadRequestException({ error: "policyId is required" });
        }
        await this.assertPolicyInAccount(ctx.accountId, policyId);
        const scope = this.parseTrendScope(query.scope);
        const days = this.parseOptionalPositiveInt(query.days);
        if (scope === "countries") {
            return (0, serialize_bigint_1.serializeBigInt)(await (0, insurancePolicyTrendService_1.getInsurancePolicyCountryTrend)(ctx.accountId, policyId, {
                countryId: this.parseOptionalPositiveInt(query.countryId),
                days,
            }));
        }
        if (scope === "named") {
            return (0, serialize_bigint_1.serializeBigInt)(await (0, insurancePolicyTrendService_1.getNamedPolicyTrend)(ctx.accountId, policyId, {
                namedPolicyId: this.parseOptionalPositiveInt(query.namedPolicyId),
                customerNumber: this.parseOptionalString(query.customerNumber),
                days,
            }));
        }
        if (scope === "changes") {
            return (0, serialize_bigint_1.serializeBigInt)(await (0, insurancePolicyTrendService_1.getInsurancePolicyConfigChanges)(ctx.accountId, policyId, {
                fromDate: this.parseOptionalString(query.fromDate),
                toDate: this.parseOptionalString(query.toDate),
            }));
        }
        return (0, serialize_bigint_1.serializeBigInt)(await (0, insurancePolicyTrendService_1.getInsurancePolicyTrend)(ctx.accountId, policyId, { days }));
    }
    async report(user, query) {
        const ctx = await this.access.authorize(user, query);
        const type = this.parseReportType(query.type);
        if (!type) {
            throw new common_1.BadRequestException({
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
                throw new common_1.NotFoundException({ error: "Customer not found" });
            }
        }
        const termsBreachReason = this.parseTermsBreachReason(query.termsBreachReason);
        const termsOverdueOnly = this.parseTruthy(query.termsOverdueOnly);
        if ((termsBreachReason != null || termsOverdueOnly) &&
            type !== "terms") {
            throw new common_1.BadRequestException({
                error: "termsBreachReason/termsOverdueOnly only allowed for type=terms",
            });
        }
        if (type === "top_up" || type === "top_up_expiring") {
            const has = await (0, hasTopUpPolicies_1.hasTopUpPolicies)(ctx.accountId);
            if (!has) {
                throw new common_1.NotFoundException({
                    error: "No top-up policies for this account",
                });
            }
        }
        const listOptions = {
            query: this.parseOptionalString(query.query),
            sortField: this.parseOptionalString(query.sortField),
            sortDirection: String(query.sortDirection || "asc").toLowerCase() === "desc"
                ? "desc"
                : "asc",
            policyId,
            customerId,
            termsBreachReason,
            termsOverdueOnly,
            withinDays: this.parseIntParam(query.withinDays, 30, 365),
            includeNoPolicyExposure: this.parseIncludeNoPolicyExposure(query.includeNoPolicyExposure),
            businessUnitFilter: ctx.businessUnitFilter,
        };
        const page = this.parsePage(query.page);
        const limit = this.parseIntParam(query.limit, 20, 10_000);
        const skip = (page - 1) * limit;
        const account = await this.db.account.findUnique({
            where: { id: ctx.accountId },
            select: { reporting_date_warning_days: true },
        });
        const reportingWindowDays = Math.max(0, account?.reporting_date_warning_days ?? 14);
        const { total, rows } = await this.runReport(ctx, type, limit, skip, listOptions, reportingWindowDays);
        const data = rows.map((row, index) => {
            const r = row;
            const id = (type === "terms" ||
                type === "reporting" ||
                type === "reported") &&
                r.invoiceId != null
                ? r.invoiceId
                : type === "top_up_expiring"
                    ? r.customerId * 1_000_000 + index
                    : r.customerId;
            return { ...row, id };
        });
        return (0, serialize_bigint_1.serializeBigInt)({ data, totalRecords: total });
    }
    async runReport(ctx, type, take, skip, options, reportingWindowDays) {
        switch (type) {
            case "overdue":
                return (0, creditInsuranceDashboardService_1.getOverdueBlockReport)(ctx.accountId, take, skip, options);
            case "capacity":
                return (0, creditInsuranceDashboardService_1.getCapacityGapReport)(ctx.accountId, take, skip, options);
            case "terms":
                return (0, creditInsuranceDashboardService_1.getTermsBreachReport)(ctx.accountId, take, skip, options);
            case "policy_risk":
                return (0, creditInsuranceDashboardService_1.getPolicyRiskExposureReport)(ctx.accountId, take, skip, options);
            case "reporting":
                return (0, creditInsuranceDashboardService_1.getReportingCountdownOpenReport)(ctx.accountId, take, skip, reportingWindowDays, options);
            case "reported":
                return (0, creditInsuranceDashboardService_1.getReportedInvoicesReport)(ctx.accountId, take, skip, options);
            case "limit_warning":
                return (0, creditInsuranceDashboardService_1.getLimitWarningReport)(ctx.accountId, take, skip, options);
            case "zero_limit_warning":
                return (0, creditInsuranceDashboardService_1.getZeroLimitWarningReport)(ctx.accountId, take, skip, options);
            case "top_up":
                return (0, creditInsuranceTopUpDashboardService_1.getTopUpCoverReport)(ctx.accountId, take, skip, options);
            case "top_up_expiring":
                return (0, creditInsuranceTopUpDashboardService_1.getTopUpExpiringReport)(ctx.accountId, take, skip, options);
            case "no_policy_exposure":
                return (0, creditInsuranceDashboardService_1.getNoPolicyExposureReport)(ctx.accountId, take, skip, options);
            default:
                throw new common_1.BadRequestException({ error: "Unknown report type" });
        }
    }
    async assertPolicyInAccount(accountId, policyId) {
        if (policyId == null)
            return;
        const policyOk = await this.db.insurancePolicy.count({
            where: { id: policyId, account_id: accountId },
        });
        if (policyOk === 0) {
            throw new common_1.NotFoundException({ error: "Policy not found" });
        }
    }
    parseOptionalPolicyId(raw) {
        return this.parseOptionalPositiveInt(raw);
    }
    parseOptionalPositiveInt(raw) {
        if (raw == null || String(raw).trim() === "")
            return undefined;
        const n = Number.parseInt(String(Array.isArray(raw) ? raw[0] : raw), 10);
        if (!Number.isFinite(n) || n < 1)
            return undefined;
        return n;
    }
    parseOptionalString(raw) {
        if (raw == null)
            return undefined;
        const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
        return s === "" ? undefined : s;
    }
    parseOptionalDate(raw) {
        return this.parseOptionalString(raw);
    }
    parseDays(raw, fallback) {
        const n = this.parseOptionalPositiveInt(raw);
        if (n == null)
            return fallback;
        return Math.min(365, Math.max(2, n));
    }
    parseIntParam(raw, fallback, max) {
        if (raw == null || String(raw).trim() === "")
            return fallback;
        const n = Number.parseInt(String(Array.isArray(raw) ? raw[0] : raw), 10);
        if (!Number.isFinite(n) || n < 0)
            return fallback;
        return Math.min(n, max);
    }
    parsePage(raw) {
        const n = this.parseIntParam(raw, 1, 1_000_000);
        return n < 1 ? 1 : n;
    }
    parseIncludeNoPolicyExposure(raw) {
        if (raw == null)
            return true;
        const v = String(Array.isArray(raw) ? raw[0] : raw)
            .trim()
            .toLowerCase();
        return !(v === "0" || v === "false" || v === "no");
    }
    parseTruthy(raw) {
        if (raw == null)
            return false;
        const v = String(Array.isArray(raw) ? raw[0] : raw)
            .trim()
            .toLowerCase();
        return v === "1" || v === "true" || v === "yes";
    }
    parseTrendScope(raw) {
        const s = this.parseOptionalString(raw)?.toLowerCase();
        if (s === "countries" || s === "named" || s === "changes")
            return s;
        return "header";
    }
    parseReportType(raw) {
        const t = this.parseOptionalString(raw);
        if (!t || !REPORT_TYPES.includes(t))
            return null;
        return t;
    }
    parseTermsBreachReason(raw) {
        const code = this.parseOptionalString(raw);
        if (!code || !(0, creditInsuranceDashboardService_1.isTermsBreachReasonFilter)(code))
            return undefined;
        return code;
    }
};
exports.CreditInsuranceLeavesService = CreditInsuranceLeavesService;
exports.CreditInsuranceLeavesService = CreditInsuranceLeavesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        credit_dashboard_access_service_1.CreditDashboardAccessService])
], CreditInsuranceLeavesService);
//# sourceMappingURL=credit-insurance-leaves.service.js.map