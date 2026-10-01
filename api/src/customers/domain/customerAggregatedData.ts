/**
 * Aggregated Data tab response shaping: collection rollups for direct children
 * plus optional shared credit-pool KPIs and claim counts.
 */

/** Aligns with claims.service `open_only` (non-terminal). */
export const AGGREGATED_DATA_TERMINAL_CLAIM_STATUSES = [
    "Paid",
    "Rejected",
    "Canceled",
] as const;

export type AggregatedDataChildInput = {
    id: number;
    customer_number: string | null;
    type: "Person" | "Company";
    name: string;
    total_due_amount: number | null;
    total_overdue_amount: number | null;
    no_of_due_invoices: number | null;
    number_of_overdue_invoices: number | null;
    customer_due_amount1: number | null;
    customer_due_currency1: string | null;
    customer_due_amount2: number | null;
    customer_due_currency2: string | null;
    customer_overdue_amount1: number | null;
    customer_overdue_currency1: string | null;
    customer_overdue_amount2: number | null;
    customer_overdue_currency2: string | null;
};

export type AggregatedDataMemberClaimCounts = {
    customer_id: number;
    open_claims_count: number;
    total_claims_count: number;
};

export type AggregatedDataCreditKpisInput = {
    root_customer_id: number;
    /** @deprecated Prefer rollup totals; kept for dual-currency gap slots. */
    approved_limit: number | null;
    approved_limit_currency: string | null;
    effective_limit: number | null;
    /** Shared / root policy capacity gap (pool total). */
    capacity_gap_amount: number | null;
    /** Pool at-risk over all member invoices (root-owned total). */
    at_risk_exposure: number | null;
    uninsured_amount: number | null;
    capacity_gap_amount1: number | null;
    capacity_gap_currency1: string | null;
    capacity_gap_amount2: number | null;
    capacity_gap_currency2: string | null;
    uninsured_amount1: number | null;
    uninsured_currency1: string | null;
    uninsured_amount2: number | null;
    uninsured_currency2: string | null;
};

export type AggregatedDataCreditMemberInput = {
    id: number;
    customer_number: string | null;
    type: "Person" | "Company";
    name: string;
    parent_customer_id: number | null;
    /** Account-currency open Due (denormalized). */
    total_due_amount: number | null;
    /** Account-currency open Overdue (denormalized). */
    total_overdue_amount: number | null;
    /** Open invoice capacity-gap attribution for this member (account currency). */
    capacity_gap_amount: number | null;
    /** At-risk exposure for this member (account currency). */
    at_risk_exposure: number | null;
    number_of_overdue_invoices?: number | null;
    no_of_due_invoices?: number | null;
    /** Prefer ungated oldest overdue date when present. */
    oldest_invoice_overdue_date_all?: Date | string | null;
    oldest_invoice_overdue_date?: Date | string | null;
};

function num(value: number | null | undefined): number {
    return Number(value ?? 0) || 0;
}

function addCurrencyAmount(
    map: Map<string, number>,
    currency: string | null | undefined,
    amount: number | null | undefined
): void {
    if (!currency || amount == null) {
        return;
    }
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) {
        return;
    }
    map.set(currency, (map.get(currency) || 0) + n);
}

function topTwoCurrencies(map: Map<string, number>): {
    amount1: number | null;
    currency1: string | null;
    amount2: number | null;
    currency2: string | null;
} {
    const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return {
        amount1: sorted[0]?.[1] ?? null,
        currency1: sorted[0]?.[0] ?? null,
        amount2: sorted[1]?.[1] ?? null,
        currency2: sorted[1]?.[0] ?? null,
    };
}

export function customerDisplayNameFromParts(parts: {
    companyName?: string | null;
    personFullName?: string | null;
    personFirstName?: string | null;
    personLastName?: string | null;
    customerNumber?: string | null;
}): string {
    const company = parts.companyName?.trim();
    if (company) {
        return company;
    }
    const full = parts.personFullName?.trim();
    if (full) {
        return full;
    }
    const person = [parts.personFirstName, parts.personLastName]
        .filter(Boolean)
        .join(" ")
        .trim();
    if (person) {
        return person;
    }
    return parts.customerNumber?.trim() || "";
}

export function isOpenAggregatedClaimStatus(status: string): boolean {
    return !(AGGREGATED_DATA_TERMINAL_CLAIM_STATUSES as readonly string[]).includes(
        status
    );
}

/**
 * Group claim rows by customer into open + total counts.
 */
export function buildClaimCountsByCustomer(
    claims: Array<{ customer_id: number; status: string }>
): Map<number, AggregatedDataMemberClaimCounts> {
    const map = new Map<number, AggregatedDataMemberClaimCounts>();
    for (const claim of claims) {
        let row = map.get(claim.customer_id);
        if (!row) {
            row = {
                customer_id: claim.customer_id,
                open_claims_count: 0,
                total_claims_count: 0,
            };
            map.set(claim.customer_id, row);
        }
        row.total_claims_count += 1;
        if (isOpenAggregatedClaimStatus(claim.status)) {
            row.open_claims_count += 1;
        }
    }
    return map;
}

export function buildChildCustomersPayload(
    children: AggregatedDataChildInput[]
): Array<{
    id: number;
    customer_number: string | null;
    name: string;
    type: "Person" | "Company";
    outstanding_amount: number;
    overdue_invoices: number;
    currency: string | null;
    due_amount: number;
    due_invoices: number;
    due_currency: string | null;
}> {
    return children.map((child) => {
        const due = num(child.total_due_amount);
        const overdue = num(child.total_overdue_amount);
        return {
            id: child.id,
            customer_number: child.customer_number,
            name: child.name,
            type: child.type,
            outstanding_amount: due + overdue,
            overdue_invoices: num(child.number_of_overdue_invoices),
            currency:
                child.customer_overdue_currency1 ||
                child.customer_due_currency1 ||
                null,
            due_amount: due,
            due_invoices: num(child.no_of_due_invoices),
            due_currency: child.customer_due_currency1 || null,
        };
    });
}

export function buildCollectionAggregatedData(
    customerId: number,
    children: AggregatedDataChildInput[],
    extras?: {
        total_paid_amount?: number | null;
        customer_total_paid_amount1?: number | null;
        customer_total_paid_amount2?: number | null;
        total_collection_periods?: number | null;
        active_collection_periods?: number | null;
        id?: number;
    }
) {
    const outstandingByCurrency = new Map<string, number>();
    const dueByCurrency = new Map<string, number>();
    let totalOutstanding = 0;
    let totalDue = 0;
    let overdueInvoices = 0;
    let dueInvoices = 0;

    for (const child of children) {
        const due = num(child.total_due_amount);
        const overdue = num(child.total_overdue_amount);
        totalDue += due;
        totalOutstanding += due + overdue;
        overdueInvoices += num(child.number_of_overdue_invoices);
        dueInvoices += num(child.no_of_due_invoices);

        addCurrencyAmount(
            outstandingByCurrency,
            child.customer_overdue_currency1,
            child.customer_overdue_amount1
        );
        addCurrencyAmount(
            outstandingByCurrency,
            child.customer_overdue_currency2,
            child.customer_overdue_amount2
        );
        addCurrencyAmount(
            outstandingByCurrency,
            child.customer_due_currency1,
            child.customer_due_amount1
        );
        addCurrencyAmount(
            outstandingByCurrency,
            child.customer_due_currency2,
            child.customer_due_amount2
        );

        addCurrencyAmount(
            dueByCurrency,
            child.customer_due_currency1,
            child.customer_due_amount1
        );
        addCurrencyAmount(
            dueByCurrency,
            child.customer_due_currency2,
            child.customer_due_amount2
        );
    }

    const outstandingTop = topTwoCurrencies(outstandingByCurrency);
    const dueTop = topTwoCurrencies(dueByCurrency);

    return {
        aggregatedData: {
            id: extras?.id ?? 0,
            customer_id: customerId,
            total_outstanding_amount: totalOutstanding,
            customer_outstanding_amount1: outstandingTop.amount1,
            customer_outstanding_amount2: outstandingTop.amount2,
            customer_currency1: outstandingTop.currency1,
            customer_currency2: outstandingTop.currency2,
            no_of_overdue_invoices: overdueInvoices,
            no_of_due_invoices: dueInvoices,
            total_invoices_count: overdueInvoices + dueInvoices,
            total_paid_amount: extras?.total_paid_amount ?? 0,
            customer_total_paid_amount1:
                extras?.customer_total_paid_amount1 ?? null,
            customer_total_paid_amount2:
                extras?.customer_total_paid_amount2 ?? null,
            total_collection_periods: extras?.total_collection_periods ?? 0,
            active_collection_periods: extras?.active_collection_periods ?? 0,
            child_customers_count: children.length,
        },
        totalDueAmount: totalDue,
        customerTotalDueAmount1: dueTop.amount1,
        customerTotalDueCurrency1: dueTop.currency1,
        customerTotalDueAmount2: dueTop.amount2,
        customerTotalDueCurrency2: dueTop.currency2,
        childCustomers: buildChildCustomersPayload(children),
    };
}

export function buildCreditAggregatedBlock(
    kpis: AggregatedDataCreditKpisInput,
    members: AggregatedDataCreditMemberInput[],
    claimCountsByCustomer: Map<number, AggregatedDataMemberClaimCounts>
) {
    let openClaimsCount = 0;
    let totalClaimsCount = 0;
    let totalDueAmount = 0;
    let totalOverdueAmount = 0;
    let numberOfOverdueInvoices = 0;
    let numberOfDueInvoices = 0;
    let oldestOverdueMs: number | null = null;

    const rootId = kpis.root_customer_id;
    const rootPolicyGap = Math.max(0, num(kpis.capacity_gap_amount));
    const poolAtRisk = Math.max(0, num(kpis.at_risk_exposure));

    const memberRows = members.map((member) => {
        const counts = claimCountsByCustomer.get(member.id) ?? {
            customer_id: member.id,
            open_claims_count: 0,
            total_claims_count: 0,
        };
        openClaimsCount += counts.open_claims_count;
        totalClaimsCount += counts.total_claims_count;

        const totalDue = num(member.total_due_amount);
        const totalOverdue = num(member.total_overdue_amount);
        const totalAr = totalDue + totalOverdue;
        const isRoot = member.id === rootId;
        // Pool capacity gap is root-only; children always show 0.
        const capacityGap = isRoot
            ? rootPolicyGap
            : 0;
        // Root shows pool at-risk; children show terms-breach-only (caller).
        const atRiskExposure = isRoot
            ? poolAtRisk
            : Math.max(0, num(member.at_risk_exposure));

        totalDueAmount += totalDue;
        totalOverdueAmount += totalOverdue;
        numberOfOverdueInvoices += num(member.number_of_overdue_invoices);
        numberOfDueInvoices += num(member.no_of_due_invoices);

        const oldestRaw =
            member.oldest_invoice_overdue_date_all ??
            member.oldest_invoice_overdue_date ??
            null;
        if (oldestRaw != null) {
            const ms = new Date(oldestRaw).getTime();
            if (Number.isFinite(ms)) {
                oldestOverdueMs =
                    oldestOverdueMs == null ? ms : Math.min(oldestOverdueMs, ms);
            }
        }

        return {
            id: member.id,
            customer_number: member.customer_number,
            name: member.name,
            type: member.type,
            parent_customer_id: member.parent_customer_id,
            total_due_amount: totalDue,
            total_overdue_amount: totalOverdue,
            total_ar: totalAr,
            capacity_gap_amount: capacityGap,
            at_risk_exposure: atRiskExposure,
            open_claims_count: counts.open_claims_count,
            total_claims_count: counts.total_claims_count,
        };
    });

    return {
        root_customer_id: kpis.root_customer_id,
        approved_limit: kpis.approved_limit,
        approved_limit_currency: kpis.approved_limit_currency,
        effective_limit: kpis.effective_limit,
        total_due_amount: totalDueAmount,
        total_overdue_amount: totalOverdueAmount,
        total_ar: totalDueAmount + totalOverdueAmount,
        number_of_overdue_invoices: numberOfOverdueInvoices,
        no_of_due_invoices: numberOfDueInvoices,
        oldest_invoice_overdue_date:
            oldestOverdueMs != null
                ? new Date(oldestOverdueMs).toISOString()
                : null,
        capacity_gap_amount: rootPolicyGap,
        at_risk_exposure: poolAtRisk,
        uninsured_amount: kpis.uninsured_amount,
        capacity_gap_amount1: kpis.capacity_gap_amount1,
        capacity_gap_currency1: kpis.capacity_gap_currency1,
        capacity_gap_amount2: kpis.capacity_gap_amount2,
        capacity_gap_currency2: kpis.capacity_gap_currency2,
        uninsured_amount1: kpis.uninsured_amount1,
        uninsured_currency1: kpis.uninsured_currency1,
        uninsured_amount2: kpis.uninsured_amount2,
        uninsured_currency2: kpis.uninsured_currency2,
        open_claims_count: openClaimsCount,
        total_claims_count: totalClaimsCount,
        members: memberRows,
    };
}
