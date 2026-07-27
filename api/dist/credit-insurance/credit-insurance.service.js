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
exports.CreditInsuranceService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const credit_dashboard_access_service_1 = require("./credit-dashboard-access.service");
const credit_insurance_leaves_service_1 = require("./credit-insurance-leaves.service");
const domain_db_1 = require("./domain-db");
const creditInsuranceDashboardService_1 = require("./domain/creditInsuranceDashboardService");
let CreditInsuranceService = class CreditInsuranceService {
    constructor(db, accessScope, access, leaves) {
        this.db = db;
        this.accessScope = accessScope;
        this.access = access;
        this.leaves = leaves;
    }
    onModuleInit() {
        (0, domain_db_1.bindCreditInsurancePrisma)(this.db);
    }
    async accountId(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveAccountId(userInfo);
    }
    async handle(leaf, user, query, body) {
        switch (leaf) {
            case "summary": {
                const ctx = await this.access.authorize(user, query);
                return this.summary(ctx, query);
            }
            case "summary-history":
                return this.leaves.summaryHistory(user, query);
            case "portfolio-health":
                return this.leaves.portfolioHealth(user, query);
            case "customer-dashboard-kpis":
                await this.access.authorize(user, query);
                return this.customerDashboardKpis(user, query);
            case "customer-policy-trend":
                return this.leaves.customerPolicyTrend(user, query);
            case "insurance-policy-trend":
                return this.leaves.insurancePolicyTrend(user, query);
            case "report":
                return this.leaves.report(user, query);
            case "mark-reported":
                await this.access.authorize(user, query);
                return this.markReported(user, body);
            case "mark-reported-bulk":
                await this.access.authorize(user, query);
                return this.markReportedBulk(user, body);
            default:
                await this.access.authorize(user, query);
                return { ok: true };
        }
    }
    parsePolicyId(query) {
        const raw = query.policyId;
        if (raw == null || String(raw).trim() === "") {
            return undefined;
        }
        const n = Number.parseInt(String(raw), 10);
        return Number.isFinite(n) && n >= 1 ? n : undefined;
    }
    parseIncludeNoPolicyExposure(query) {
        const raw = query.includeNoPolicyExposure;
        if (raw == null || String(raw).trim() === "") {
            return true;
        }
        const value = String(Array.isArray(raw) ? raw[0] : raw)
            .trim()
            .toLowerCase();
        return !(value === "0" || value === "false" || value === "no");
    }
    async summary(ctx, query) {
        const policyId = this.parsePolicyId(query);
        const includeNoPolicy = this.parseIncludeNoPolicyExposure(query);
        const summary = await (0, creditInsuranceDashboardService_1.getCreditDashboardSummary)(ctx.accountId, policyId, ctx.businessUnitFilter, includeNoPolicy);
        return (0, serialize_bigint_1.serializeBigInt)(summary);
    }
    async customerDashboardKpis(user, query) {
        const accountId = await this.accountId(user);
        const customerId = query.customer_id
            ? parseInt(String(query.customer_id), 10)
            : null;
        if (!customerId) {
            return { kpis: {} };
        }
        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            include: { CustomerPolicy: true },
        });
        if (!customer) {
            return { kpis: {} };
        }
        return (0, serialize_bigint_1.serializeBigInt)({
            kpis: {
                approvedLimit: customer.CustomerPolicy?.[0]?.approved_limit ?? null,
                capacityGap: customer.CustomerPolicy?.[0]?.capacity_gap_amount ?? 0,
            },
        });
    }
    async markReported(user, body) {
        const accountId = await this.accountId(user);
        const invoiceId = body.invoiceId
            ? parseInt(String(body.invoiceId), 10)
            : null;
        if (!invoiceId) {
            throw new common_1.BadRequestException({ error: "invoiceId is required" });
        }
        const updated = await this.db.invoice.updateMany({
            where: { id: invoiceId, account_id: accountId },
            data: {
                reported_status: "Reported",
                reporting_comment: body.comment ?? undefined,
                reporting_captured_at: new Date(),
            },
        });
        return { ok: true, updated: updated.count };
    }
    async markReportedBulk(user, body) {
        const accountId = await this.accountId(user);
        const invoiceIds = Array.isArray(body.invoiceIds)
            ? body.invoiceIds.map((v) => parseInt(String(v), 10))
            : [];
        if (invoiceIds.length === 0) {
            throw new common_1.BadRequestException({
                error: "invoiceIds must be a non-empty array",
            });
        }
        const updated = await this.db.invoice.updateMany({
            where: { id: { in: invoiceIds }, account_id: accountId },
            data: {
                reported_status: "Reported",
                reporting_comment: body.comment ?? undefined,
                reporting_captured_at: new Date(),
            },
        });
        return { ok: true, updated: updated.count };
    }
};
exports.CreditInsuranceService = CreditInsuranceService;
exports.CreditInsuranceService = CreditInsuranceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService,
        credit_dashboard_access_service_1.CreditDashboardAccessService,
        credit_insurance_leaves_service_1.CreditInsuranceLeavesService])
], CreditInsuranceService);
//# sourceMappingURL=credit-insurance.service.js.map