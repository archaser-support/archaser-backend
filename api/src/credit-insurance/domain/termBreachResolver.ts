import { prisma } from "../domain-db";
import {
    hasActiveLinkedPolicy,
    isUncoveredExposureCustomer,
    type UncoveredExposureFields,
} from "./policyExclusion";
import { invoiceHasTermsBreachFlag } from "./customerPolicyTrendTermsBreachByReason";
import { shouldSetReportingBreach } from "./invoiceInsuranceFields";
import type { TermsBreachCountByReason } from "./creditInsuranceDashboardService";

export type TermBreachInvoiceRow = {
    outstanding: number;
    inCapacityGap?: boolean;
    capacityGapAmount?: number;
    targetReportingDate?: Date | null;
    reportingBreach?: boolean;
    ctvPaymentTerm?: boolean;
    ctvCustomerOverdueMep?: boolean;
    ctvOutdatedDcl?: boolean;
    ctvInvoiceAfterPolicyEnd?: boolean;
};

export type PolicyRowForUncoveredExposure = {
    insurance_policy_id: number | null;
    is_active?: boolean;
    policy_exclusion_reason?: string | null;
};

export function invoiceHasTermsBreachForKpi(
    invoice: TermBreachInvoiceRow,
    asOf: Date
): boolean {
    if (invoice.outstanding <= 0) {
        return false;
    }

    if (
        invoiceHasTermsBreachFlag({
            reportingBreach: invoice.reportingBreach ?? false,
            ctvPaymentTerm: invoice.ctvPaymentTerm ?? false,
            ctvCustomerOverdueMep: invoice.ctvCustomerOverdueMep ?? false,
            ctvOutdatedDcl: invoice.ctvOutdatedDcl ?? false,
            ctvInvoiceAfterPolicyEnd: invoice.ctvInvoiceAfterPolicyEnd ?? false,
        })
    ) {
        return true;
    }

    return shouldSetReportingBreach(
        "Due",
        invoice.targetReportingDate ?? null,
        null,
        asOf
    );
}

export function sumFlagBasedTermsBreachOutstanding(
    invoices: TermBreachInvoiceRow[],
    asOf: Date,
    options?: { excludeCapacityGapInvoices?: boolean }
): number {
    let total = 0;
    for (const invoice of invoices) {
        if (!invoiceHasTermsBreachForKpi(invoice, asOf)) {
            continue;
        }

        const outstanding = Math.max(0, invoice.outstanding);
        if (options?.excludeCapacityGapInvoices) {
            total += Math.max(
                0,
                outstanding - Math.max(0, invoice.capacityGapAmount ?? 0)
            );
            continue;
        }

        total += outstanding;
    }
    return total;
}

/**
 * Customer-level terms breach: uncovered → full open AR; else flag-based sum.
 */
export function resolveCustomerTermsBreachOutstanding(args: {
    uncovered: boolean;
    totalOpenAr: number;
    invoices: TermBreachInvoiceRow[];
    asOf: Date;
    excludeCapacityGapInvoices?: boolean;
}): number {
    if (args.uncovered) {
        return Math.max(0, args.totalOpenAr);
    }
    return sumFlagBasedTermsBreachOutstanding(args.invoices, args.asOf, {
        excludeCapacityGapInvoices: args.excludeCapacityGapInvoices,
    });
}

/** Portfolio Terms Breach card/chart: uncovered customers contribute zero. */
export function resolvePortfolioTermsBreachContribution(args: {
    uncovered: boolean;
    flagBasedAmount: number;
}): number {
    if (args.uncovered) {
        return 0;
    }
    return Math.max(0, args.flagBasedAmount);
}

export function resolveUncoveredExposureFromPolicyRows(
    policyRows: PolicyRowForUncoveredExposure[],
    policyId?: number | null
): boolean {
    if (policyRows.length === 0) {
        return true;
    }

    const scopedRow =
        policyId != null
            ? policyRows.find((row) => row.insurance_policy_id === policyId) ??
              policyRows[0]
            : policyRows.find((row) => row.is_active) ?? policyRows[0];

    return isUncoveredExposureCustomer({
        hasLinkedPolicy: hasActiveLinkedPolicy(scopedRow?.insurance_policy_id),
        exclusionReason: scopedRow?.policy_exclusion_reason,
    });
}

export function uncoveredExposureFieldsFromPolicyRows(
    policyRows: PolicyRowForUncoveredExposure[],
    policyId?: number | null
): UncoveredExposureFields {
    if (policyRows.length === 0) {
        return { hasLinkedPolicy: false, exclusionReason: null };
    }

    const scopedRow =
        policyId != null
            ? policyRows.find((row) => row.insurance_policy_id === policyId) ??
              policyRows[0]
            : policyRows.find((row) => row.is_active) ?? policyRows[0];

    return {
        hasLinkedPolicy: hasActiveLinkedPolicy(scopedRow?.insurance_policy_id),
        exclusionReason: scopedRow?.policy_exclusion_reason,
    };
}

export type PortfolioTermsBreachInvoiceRow = {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    amount?: number | null;
    reporting_breach: boolean;
    ctv_payment_term: boolean;
    ctv_customer_overdue_mep: boolean;
    ctv_outdated_dcl: boolean;
    ctv_invoice_after_policy_end: boolean;
};

function lineOutstandingFromInvoiceRow(row: PortfolioTermsBreachInvoiceRow): number {
    const debt = Number(row.outstanding_debt ?? 0);
    if (debt !== 0) {
        return Math.max(0, debt);
    }
    return Math.max(0, Number(row.customer_outstanding_debt ?? 0));
}

export function aggregatePortfolioTermsBreachFromInvoices(
    invoices: PortfolioTermsBreachInvoiceRow[]
): {
    invoiceCount: number;
    totalAmount: number;
    countByReason: TermsBreachCountByReason;
} {
    let totalAmount = 0;
    const countByReason: TermsBreachCountByReason = {
        reportingBreach: 0,
        paymentTerm: 0,
        customerOverdueMep: 0,
        outdatedDcl: 0,
        invoiceAfterPolicyEnd: 0,
    };

    for (const invoice of invoices) {
        totalAmount += lineOutstandingFromInvoiceRow(invoice);
        if (invoice.reporting_breach) {
            countByReason.reportingBreach += 1;
        }
        if (invoice.ctv_payment_term) {
            countByReason.paymentTerm += 1;
        }
        if (invoice.ctv_customer_overdue_mep) {
            countByReason.customerOverdueMep += 1;
        }
        if (invoice.ctv_outdated_dcl) {
            countByReason.outdatedDcl += 1;
        }
        if (invoice.ctv_invoice_after_policy_end) {
            countByReason.invoiceAfterPolicyEnd += 1;
        }
    }

    return {
        invoiceCount: invoices.length,
        totalAmount,
        countByReason,
    };
}

/** Active-policy uncovered customers for notification suppression. */
export async function fetchUncoveredCustomerIdsForAccount(
    accountId: number
): Promise<Set<number>> {
    const rows = await prisma.customer.findMany({
        where: { account_id: accountId },
        select: {
            id: true,
            CustomerPolicy: {
                where: { is_active: true },
                select: {
                    insurance_policy_id: true,
                    policy_exclusion_reason: true,
                },
                take: 1,
            },
        },
    });

    const uncovered = new Set<number>();
    for (const row of rows) {
        const policy = row.CustomerPolicy[0];
        if (
            isUncoveredExposureCustomer({
                hasLinkedPolicy: hasActiveLinkedPolicy(
                    policy?.insurance_policy_id
                ),
                exclusionReason: policy?.policy_exclusion_reason,
            })
        ) {
            uncovered.add(row.id);
        }
    }
    return uncovered;
}
