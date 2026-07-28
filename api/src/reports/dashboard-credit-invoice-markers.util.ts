import { ReportFilterDto } from "./dto/execute-report.dto";
import {
    reportedInvoicesMembershipWhere,
    reportingCountdownMembershipWhere,
    resolveReportingCountdownWindowDays,
    termsBreachMembershipWhere,
} from "../credit-insurance/domain/creditDashboardInvoiceMembership";

type PrismaWhere = Record<string, unknown>;

export const CREDIT_DASHBOARD_INVOICE_MEMBERSHIP_FILTER_FIELD =
    "__credit_dashboard_invoice_membership";

export type PreparedDashboardCreditInvoiceMarkers = {
    filters: ReportFilterDto[];
    primaryWhereExtras?: PrismaWhere;
};

export function parseCreditDashboardInvoiceMembershipValue(value: unknown): {
    type: "terms" | "reporting" | "reported" | null;
    termsBreachReason: string | null;
    termsOverdueOnly: boolean;
} {
    const raw = value == null ? "" : String(value);
    if (raw === "reporting" || raw === "reported") {
        return {
            type: raw,
            termsBreachReason: null,
            termsOverdueOnly: false,
        };
    }
    if (raw === "terms") {
        return {
            type: "terms",
            termsBreachReason: null,
            termsOverdueOnly: false,
        };
    }
    if (raw.startsWith("terms:")) {
        const rest = raw.slice("terms:".length);
        const segments = rest.split(":").filter(Boolean);
        let termsOverdueOnly = false;
        let termsBreachReason: string | null = null;
        for (const seg of segments) {
            if (seg === "overdue") {
                termsOverdueOnly = true;
            } else {
                termsBreachReason = seg;
            }
        }
        return { type: "terms", termsBreachReason, termsOverdueOnly };
    }
    return {
        type: null,
        termsBreachReason: null,
        termsOverdueOnly: false,
    };
}

/**
 * Strip credit dashboard invoice membership markers and expand into Prisma
 * where extras (terms / reporting / reported cohorts).
 */
export async function prepareDashboardCreditInvoiceMarkers(
    filters: ReportFilterDto[],
    options: { accountId: number }
): Promise<PreparedDashboardCreditInvoiceMarkers> {
    if (!filters?.length) {
        return { filters: filters ?? [] };
    }

    const membershipIndex = filters.findIndex(
        (f) =>
            f.table === "Invoice" &&
            f.field === CREDIT_DASHBOARD_INVOICE_MEMBERSHIP_FILTER_FIELD
    );

    if (membershipIndex < 0) {
        return { filters };
    }

    const marker = filters[membershipIndex];
    const parsed = parseCreditDashboardInvoiceMembershipValue(marker.value);
    const rest = filters.filter((_, i) => i !== membershipIndex);

    if (!parsed.type) {
        return { filters: rest };
    }

    const policyIdFilter = rest.find(
        (f) =>
            f.table === "Invoice" &&
            f.field === "policy_id" &&
            f.operator === "equals"
    );
    const customerIdFilter = rest.find(
        (f) =>
            f.table === "Invoice" &&
            f.field === "customer_id" &&
            f.operator === "equals"
    );
    const policyId =
        policyIdFilter != null && Number.isFinite(Number(policyIdFilter.value))
            ? Number(policyIdFilter.value)
            : undefined;
    const customerId =
        customerIdFilter != null &&
        Number.isFinite(Number(customerIdFilter.value))
            ? Number(customerIdFilter.value)
            : undefined;

    const stripScopeFilters = (list: ReportFilterDto[]) =>
        list.filter(
            (f) =>
                !(
                    f.table === "Invoice" &&
                    (f.field === "policy_id" || f.field === "customer_id")
                )
        );

    if (parsed.type === "terms") {
        return {
            filters: stripScopeFilters(rest),
            primaryWhereExtras: termsBreachMembershipWhere(options.accountId, {
                termsBreachReason: parsed.termsBreachReason,
                termsOverdueOnly: parsed.termsOverdueOnly,
                policyId,
                customerId,
            }) as PrismaWhere,
        };
    }

    if (parsed.type === "reporting") {
        const windowDays = await resolveReportingCountdownWindowDays(
            options.accountId
        );
        return {
            filters: stripScopeFilters(rest),
            primaryWhereExtras: reportingCountdownMembershipWhere(
                options.accountId,
                windowDays,
                { policyId, customerId }
            ) as PrismaWhere,
        };
    }

    return {
        filters: stripScopeFilters(rest),
        primaryWhereExtras: reportedInvoicesMembershipWhere(options.accountId, {
            policyId,
            customerId,
        }) as PrismaWhere,
    };
}
