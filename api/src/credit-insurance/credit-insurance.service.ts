import {
    BadRequestException,
    Injectable,
    NotFoundException,
    OnModuleInit,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import { CreditDashboardAccessService } from "./credit-dashboard-access.service";
import { CreditInsuranceLeavesService } from "./credit-insurance-leaves.service";
import { bindCreditInsurancePrisma } from "./domain-db";
import { getCustomerDashboardKpis } from "./domain/customerDashboardKpisService";
import { getCreditDashboardSummary } from "./domain/creditInsuranceDashboardService";

/**
 * Nest-native credit-insurance KPIs. Returns the UI contract
 * (`CreditDashboardSummary`) so CreditDashboardScreen does not crash.
 */
@Injectable()
export class CreditInsuranceService implements OnModuleInit {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService,
        private readonly access: CreditDashboardAccessService,
        private readonly leaves: CreditInsuranceLeavesService
    ) {}

    onModuleInit() {
        bindCreditInsurancePrisma(this.db);
    }

    private async accountId(user: JwtPayload): Promise<number> {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveAccountId(userInfo);
    }

    async handle(
        leaf: string,
        user: JwtPayload,
        query: Record<string, unknown>,
        body: Record<string, unknown>
    ) {
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

    private parsePolicyId(query: Record<string, unknown>): number | undefined {
        const raw = query.policyId;
        if (raw == null || String(raw).trim() === "") {
            return undefined;
        }
        const n = Number.parseInt(String(raw), 10);
        return Number.isFinite(n) && n >= 1 ? n : undefined;
    }

    private parseIncludeNoPolicyExposure(
        query: Record<string, unknown>
    ): boolean {
        const raw = query.includeNoPolicyExposure;
        if (raw == null || String(raw).trim() === "") {
            return true;
        }
        const value = String(Array.isArray(raw) ? raw[0] : raw)
            .trim()
            .toLowerCase();
        // Frontend sends "0" when "Without excluded customers" is selected.
        return !(value === "0" || value === "false" || value === "no");
    }

    private async summary(
        ctx: Awaited<ReturnType<CreditDashboardAccessService["authorize"]>>,
        query: Record<string, unknown>
    ) {
        const policyId = this.parsePolicyId(query);
        const includeNoPolicy = this.parseIncludeNoPolicyExposure(query);

        const summary = await getCreditDashboardSummary(
            ctx.accountId,
            policyId,
            ctx.businessUnitFilter as never,
            includeNoPolicy
        );
        return serializeBigInt(summary);
    }

    private parseCustomerId(query: Record<string, unknown>): number | null {
        // The customer dashboard sends `customerId`; older callers use `customer_id`.
        const raw = query.customerId ?? query.customer_id;
        if (raw == null || String(raw).trim() === "") {
            return null;
        }
        const parsed = Number.parseInt(String(raw), 10);
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
    }

    private parseDays(query: Record<string, unknown>): number | undefined {
        const raw = query.days;
        if (raw == null || String(raw).trim() === "") {
            return undefined;
        }
        const parsed = Number.parseInt(String(raw), 10);
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : undefined;
    }

    private async customerDashboardKpis(
        user: JwtPayload,
        query: Record<string, unknown>
    ) {
        const accountId = await this.accountId(user);
        const customerId = this.parseCustomerId(query);
        if (!customerId) {
            throw new BadRequestException({ error: "customerId is required" });
        }

        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: { id: true },
        });
        if (!customer) {
            throw new NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }

        const kpis = await getCustomerDashboardKpis(accountId, customerId, {
            policyId: this.parsePolicyId(query),
            days: this.parseDays(query),
        });

        return serializeBigInt(kpis);
    }

    private async markReported(
        user: JwtPayload,
        body: Record<string, unknown>
    ) {
        const accountId = await this.accountId(user);
        const invoiceId = body.invoiceId
            ? parseInt(String(body.invoiceId), 10)
            : null;
        if (!invoiceId) {
            throw new BadRequestException({ error: "invoiceId is required" });
        }

        const updated = await this.db.invoice.updateMany({
            where: { id: invoiceId, account_id: accountId },
            data: {
                reported_status: "Reported",
                reporting_comment: (body.comment as string) ?? undefined,
                reporting_captured_at: new Date(),
            },
        });

        return { ok: true, updated: updated.count };
    }

    private async markReportedBulk(
        user: JwtPayload,
        body: Record<string, unknown>
    ) {
        const accountId = await this.accountId(user);
        const invoiceIds = Array.isArray(body.invoiceIds)
            ? (body.invoiceIds as unknown[]).map((v) =>
                  parseInt(String(v), 10)
              )
            : [];
        if (invoiceIds.length === 0) {
            throw new BadRequestException({
                error: "invoiceIds must be a non-empty array",
            });
        }

        const updated = await this.db.invoice.updateMany({
            where: { id: { in: invoiceIds }, account_id: accountId },
            data: {
                reported_status: "Reported",
                reporting_comment: (body.comment as string) ?? undefined,
                reporting_captured_at: new Date(),
            },
        });

        return { ok: true, updated: updated.count };
    }
}
