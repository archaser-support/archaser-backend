import { ReportFilterDto } from "./dto/execute-report.dto";
import {
    customersScopedForCreditDashboard,
    resolveCreditCustomerMembershipIds,
    zeroLimitWarningMembershipWhere,
} from "@archaser/credit-insurance-domain";

type PrismaWhere = Record<string, unknown>;

export const CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD =
    "__credit_dashboard_customer_scope";
export const CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD =
    "__credit_dashboard_customer_membership";

export type PreparedDashboardCreditCustomerMarkers = {
    filters: ReportFilterDto[];
    primaryWhereExtras?: PrismaWhere;
    policyId?: number;
    /** From top_up_expiring membership value; default 30 when type matches. */
    withinDays?: number;
    /** From utilization_bin membership value (YYYY-MM-DD). */
    asOfDate?: string;
    /** From utilization_bin membership value. */
    utilizationBin?: string;
    membershipType?:
        | "capacity"
        | "policy_risk"
        | "limit_warning"
        | "zero_limit_warning"
        | "no_policy_exposure"
        | "top_up"
        | "top_up_expiring"
        | "utilization_bin"
        | null;
};

function andWhere(
    parts: Array<PrismaWhere | undefined>
): PrismaWhere | undefined {
    const defined = parts.filter(
        (p): p is PrismaWhere => p != null && Object.keys(p).length > 0
    );
    if (defined.length === 0) {
        return undefined;
    }
    if (defined.length === 1) {
        return defined[0];
    }
    return { AND: defined };
}

export function parseCreditDashboardCustomerScopeValue(
    value: unknown
): number | undefined {
    if (value == null || value === "" || value === "all") {
        return undefined;
    }
    const n =
        typeof value === "number" ? value : Number.parseInt(String(value), 10);
    return Number.isFinite(n) ? n : undefined;
}

export function parseCreditDashboardCustomerMembershipValue(value: unknown): {
    type:
        | "capacity"
        | "policy_risk"
        | "limit_warning"
        | "zero_limit_warning"
        | "no_policy_exposure"
        | "top_up"
        | "top_up_expiring"
        | "utilization_bin"
        | null;
    includeNoPolicyExposure: boolean;
    withinDays: number | null;
    utilizationBin: string | null;
    asOfDate: string | null;
} {
    const raw = value == null ? "" : String(value);
    if (
        raw === "capacity" ||
        raw === "policy_risk" ||
        raw === "limit_warning" ||
        raw === "zero_limit_warning" ||
        raw === "top_up"
    ) {
        return {
            type: raw,
            includeNoPolicyExposure: true,
            withinDays: null,
            utilizationBin: null,
            asOfDate: null,
        };
    }
    if (raw === "no_policy_exposure") {
        return {
            type: "no_policy_exposure",
            includeNoPolicyExposure: true,
            withinDays: null,
            utilizationBin: null,
            asOfDate: null,
        };
    }
    if (raw === "no_policy_exposure:0") {
        return {
            type: "no_policy_exposure",
            includeNoPolicyExposure: false,
            withinDays: null,
            utilizationBin: null,
            asOfDate: null,
        };
    }
    if (raw === "top_up_expiring") {
        return {
            type: "top_up_expiring",
            includeNoPolicyExposure: true,
            withinDays: 30,
            utilizationBin: null,
            asOfDate: null,
        };
    }
    if (raw.startsWith("top_up_expiring:")) {
        const days = Number.parseInt(raw.slice("top_up_expiring:".length), 10);
        return {
            type: "top_up_expiring",
            includeNoPolicyExposure: true,
            withinDays: Number.isFinite(days) ? Math.max(1, days) : 30,
            utilizationBin: null,
            asOfDate: null,
        };
    }
    // utilization_bin:<bin>:<asOfYmd> or …:0 for exclude no-policy
    if (raw.startsWith("utilization_bin:")) {
        const parts = raw.split(":");
        const bin = parts[1] ?? "";
        const asOfDate = parts[2] ?? "";
        const excludeFlag = parts[3];
        return {
            type: "utilization_bin",
            includeNoPolicyExposure: excludeFlag !== "0",
            withinDays: null,
            utilizationBin: bin || null,
            asOfDate: /^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ? asOfDate : null,
        };
    }
    return {
        type: null,
        includeNoPolicyExposure: true,
        withinDays: null,
        utilizationBin: null,
        asOfDate: null,
    };
}

/**
 * Strip credit dashboard customer scope / membership markers and expand into
 * Prisma where extras (KPI cohort parity with get*Report).
 */
export async function prepareDashboardCreditCustomerMarkers(
    filters: ReportFilterDto[],
    options: { accountId: number }
): Promise<PreparedDashboardCreditCustomerMarkers> {
    if (!filters?.length) {
        return { filters: filters ?? [] };
    }

    let working = [...filters];
    let scopeWhere: PrismaWhere | undefined;
    let membershipWhere: PrismaWhere | undefined;
    let policyId: number | undefined;
    let withinDays: number | undefined;
    let asOfDate: string | undefined;
    let utilizationBin: string | undefined;
    let membershipType: PreparedDashboardCreditCustomerMarkers["membershipType"];

    const scopeIndex = working.findIndex(
        (f) =>
            f.table === "Customer" &&
            f.field === CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD
    );

    if (scopeIndex >= 0) {
        const marker = working[scopeIndex];
        policyId = parseCreditDashboardCustomerScopeValue(marker.value);
        scopeWhere = customersScopedForCreditDashboard(
            options.accountId,
            policyId
        ) as PrismaWhere;
        working = working.filter((_, i) => i !== scopeIndex);

        const membershipIndex = working.findIndex(
            (f) =>
                f.table === "Customer" &&
                f.field === CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD
        );

        if (membershipIndex >= 0) {
            const membershipMarker = working[membershipIndex];
            const parsed = parseCreditDashboardCustomerMembershipValue(
                membershipMarker.value
            );
            membershipType = parsed.type;
            if (parsed.type === "top_up_expiring") {
                withinDays = parsed.withinDays ?? 30;
            }
            if (parsed.type === "utilization_bin") {
                asOfDate = parsed.asOfDate ?? undefined;
                utilizationBin = parsed.utilizationBin ?? undefined;
            }
            working = working.filter((_, i) => i !== membershipIndex);

            if (parsed.type === "zero_limit_warning") {
                membershipWhere = zeroLimitWarningMembershipWhere({
                    policyId,
                }) as PrismaWhere;
            } else if (parsed.type != null) {
                const customerIdFilter = working.find(
                    (f) =>
                        f.table === "Customer" &&
                        f.field === "id" &&
                        f.operator === "equals"
                );
                const customerId =
                    customerIdFilter != null &&
                    Number.isFinite(Number(customerIdFilter.value))
                        ? Number(customerIdFilter.value)
                        : undefined;

                const ids = await resolveCreditCustomerMembershipIds(
                    parsed.type,
                    options.accountId,
                    {
                        policyId,
                        customerId,
                        includeNoPolicyExposure:
                            parsed.includeNoPolicyExposure,
                        withinDays: parsed.withinDays ?? undefined,
                        utilizationBin: parsed.utilizationBin ?? undefined,
                        asOfDate: parsed.asOfDate ?? undefined,
                    }
                );
                membershipWhere = {
                    id: { in: ids ?? [] },
                };
            }
        }
    } else {
        working = working.filter(
            (f) =>
                !(
                    f.table === "Customer" &&
                    f.field ===
                        CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD
                )
        );
    }

    return {
        filters: working,
        primaryWhereExtras:
            membershipType === "utilization_bin"
                ? membershipWhere
                : andWhere([scopeWhere, membershipWhere]),
        policyId,
        withinDays,
        asOfDate,
        utilizationBin,
        membershipType,
    };
}
