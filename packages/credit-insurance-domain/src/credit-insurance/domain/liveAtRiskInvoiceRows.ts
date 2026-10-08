import { Prisma } from "@prisma/client";

import { prisma, type DbClient } from "../domain-db";
import {
    allocateNetCapacityGapWaterfall,
    type NetCapacityGapWaterfallRow,
    type NetCapacityGapWaterfallScope,
} from "./invoiceInsuranceFields";
import {
    OPEN_AR_VAT_BASIS_CUSTOMER_LINE_SQL,
    OPEN_AR_VAT_BASIS_LINE_SQL,
} from "./openArVatBasis";
import {
    createCreditPoolMembershipCache,
    hydrateCreditPoolMembershipCacheForAccount,
} from "./parentCustomerCreditInheritance";
import {
    hasActiveLinkedPolicy,
    isAtRiskExposureCustomer,
} from "./policyExclusion";
import {
    loadActiveTopUpsByCustomerIdForAccount,
    resolveEffectiveApprovedLimitFromTopUpRows,
    type TopUpRowForResolution,
} from "./resolveEffectiveApprovedLimit";
import { startOfTodayUtc } from "./shared/insurancePolicyLifecycle";

/** Open Due/Overdue invoice with live at-risk inputs (non-negative amounts only). */
export type LiveAtRiskInvoiceRow = {
    customerId: number;
    rootCustomerId: number;
    customerCurrency: string;
    /** Account-currency open (VAT basis). */
    outstanding: number;
    /** Customer/invoice-currency open (VAT basis). */
    customerOutstanding: number;
    hasTermsBreach: boolean;
    /** Net-waterfall gap in account currency (stored gap outside a waterfall scope). */
    capacityGapAmount: number;
    /** Same gap in limit currency. */
    capacityGapAmountLimit: number;
};

type LiveOpenInvoiceSqlRow = {
    id: number;
    customer_id: number;
    policy_id: number | null;
    amount: number | null;
    invoice_date: Date | null;
    due_date: Date | null;
    customer_currency: string;
    account_currency: string | null;
    outstanding: number | null;
    customer_outstanding: number | null;
    capacity_gap_amount: number | null;
    capacity_gap_amount_limit: number | null;
    has_terms_breach: boolean | null;
};

/**
 * Live open invoices for per-invoice at-risk with capacity gaps recomputed in
 * memory by the same net waterfall the as-of snapshot uses: full credit pool
 * remapped to the root, root effective limit (base + active top-ups) in the
 * root limit currency, open credit notes netted first. Stored
 * `Invoice.capacity_gap_amount` stays the gross persisted waterfall.
 *
 * Returns rows for `customerIds` (all account customers when omitted); pool
 * siblings outside that set are loaded only to feed the waterfall.
 */
export async function loadLiveAtRiskInvoiceRows(
    accountId: number,
    options?: {
        customerIds?: readonly number[];
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<LiveAtRiskInvoiceRow[]> {
    const dbClient = options?.dbClient ?? prisma;
    const requestedIds =
        options?.customerIds != null
            ? [...new Set(options.customerIds.filter(Number.isFinite))]
            : null;
    if (requestedIds != null && requestedIds.length === 0) {
        return [];
    }

    const membership = await hydrateCreditPoolMembershipCacheForAccount(
        accountId,
        dbClient,
        createCreditPoolMembershipCache()
    );
    const rootOf = (customerId: number): number =>
        membership.rootByCustomerId.get(customerId) ?? customerId;

    let invoiceCustomerIds: number[] | null = null;
    let candidateRootIds: Set<number>;
    if (requestedIds != null) {
        candidateRootIds = new Set(requestedIds.map(rootOf));
        const memberIds = new Set<number>();
        for (const rootId of candidateRootIds) {
            memberIds.add(rootId);
            for (const id of membership.descendantsByCustomerId.get(rootId) ??
                []) {
                memberIds.add(id);
            }
        }
        invoiceCustomerIds = [...memberIds];
    } else {
        candidateRootIds = new Set(membership.rootByCustomerId.values());
    }

    const today = startOfTodayUtc();
    const [rows, candidateLimitInputs] = await Promise.all([
        queryLiveOpenInvoiceRows(
            accountId,
            invoiceCustomerIds,
            options?.policyId,
            dbClient
        ),
        loadRootLimitInputs(accountId, [...candidateRootIds], today, dbClient),
    ]);
    if (rows.length === 0) {
        return [];
    }

    const accountCurrency = rows[0]!.account_currency?.trim().toUpperCase() || null;
    const rootIds = [...new Set(rows.map((row) => rootOf(row.customer_id)))];
    // Invoice customers missing from the account's Customer rows root at themselves.
    const outsideRootIds = rootIds.filter((id) => !candidateRootIds.has(id));
    const limitInputs =
        outsideRootIds.length > 0
            ? mergeRootLimitInputs(
                  candidateLimitInputs,
                  await loadRootLimitInputs(
                      accountId,
                      outsideRootIds,
                      today,
                      dbClient
                  )
              )
            : candidateLimitInputs;
    const scopeByRootId = await buildLiveWaterfallScopes(
        rootIds,
        limitInputs,
        accountCurrency,
        today
    );

    const rowsByRoot = new Map<number, NetCapacityGapWaterfallRow[]>();
    for (const row of rows) {
        const rootId = rootOf(row.customer_id);
        const scope = scopeByRootId.get(rootId);
        if (scope == null || row.policy_id !== scope.policyId) {
            continue;
        }
        const bucket = rowsByRoot.get(rootId) ?? [];
        bucket.push({
            id: row.id,
            openAccount: Number(row.outstanding ?? 0),
            openCustomer: Number(row.customer_outstanding ?? 0),
            customerCurrency: row.customer_currency || null,
            invoiceDate: row.invoice_date,
            dueDate: row.due_date,
        });
        rowsByRoot.set(rootId, bucket);
    }
    const gapByInvoiceId = new Map<
        number,
        { gapAccount: number; gapLimit: number }
    >();
    for (const [rootId, scopeRows] of rowsByRoot) {
        for (const [invoiceId, allocation] of allocateNetCapacityGapWaterfall(
            scopeRows,
            scopeByRootId.get(rootId)!,
            accountCurrency
        )) {
            gapByInvoiceId.set(invoiceId, allocation);
        }
    }

    const requestedSet = requestedIds != null ? new Set(requestedIds) : null;
    const out: LiveAtRiskInvoiceRow[] = [];
    for (const row of rows) {
        if (requestedSet != null && !requestedSet.has(row.customer_id)) {
            continue;
        }
        if (row.amount == null || row.amount < 0) {
            continue;
        }
        const gap = gapByInvoiceId.get(row.id);
        out.push({
            customerId: row.customer_id,
            rootCustomerId: rootOf(row.customer_id),
            customerCurrency: row.customer_currency,
            outstanding: Math.max(0, Number(row.outstanding ?? 0)),
            customerOutstanding: Math.max(
                0,
                Number(row.customer_outstanding ?? 0)
            ),
            hasTermsBreach: row.has_terms_breach === true,
            capacityGapAmount: Math.max(
                0,
                gap?.gapAccount ?? Number(row.capacity_gap_amount ?? 0)
            ),
            capacityGapAmountLimit: Math.max(
                0,
                gap?.gapLimit ?? Number(row.capacity_gap_amount_limit ?? 0)
            ),
        });
    }
    return out;
}

async function queryLiveOpenInvoiceRows(
    accountId: number,
    invoiceCustomerIds: readonly number[] | null,
    policyId: number | undefined,
    dbClient: DbClient
): Promise<LiveOpenInvoiceSqlRow[]> {
    const outstanding = Prisma.raw(OPEN_AR_VAT_BASIS_LINE_SQL);
    const customerOutstanding = Prisma.raw(OPEN_AR_VAT_BASIS_CUSTOMER_LINE_SQL);
    return dbClient.$queryRaw<LiveOpenInvoiceSqlRow[]>`
        SELECT
          i.id,
          i.customer_id,
          i.policy_id,
          i.amount::float AS amount,
          i.invoice_date,
          i.due_date,
          UPPER(COALESCE(i.customer_currency, '')) AS customer_currency,
          a.currency AS account_currency,
          (${outstanding})::float AS outstanding,
          (${customerOutstanding})::float AS customer_outstanding,
          COALESCE(i.capacity_gap_amount, 0)::float AS capacity_gap_amount,
          COALESCE(i.capacity_gap_amount_limit, 0)::float AS capacity_gap_amount_limit,
          (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          ) AS has_terms_breach
        FROM "Invoice" i
        INNER JOIN "Account" a ON a.id = i.account_id
        WHERE i.account_id = ${accountId}
          AND i.status IN ('Due', 'Overdue')
          ${invoiceCustomerIds != null ? Prisma.sql`AND i.customer_id IN (${Prisma.join(invoiceCustomerIds)})` : Prisma.empty}
          ${policyId != null ? Prisma.sql`AND i.policy_id = ${policyId}` : Prisma.empty}
    `;
}

type RootLimitInputs = {
    policyByRootId: Map<number, RootPolicyRow>;
    topUpsByOwnerId: Map<number, TopUpRowForResolution[]>;
};

type RootPolicyRow = Awaited<ReturnType<typeof loadRootActivePolicies>>[number];

function loadRootActivePolicies(rootIds: readonly number[], dbClient: DbClient) {
    return dbClient.customerPolicy.findMany({
        where: {
            customer_id: { in: [...rootIds] },
            is_active: true,
            insurance_policy_id: { not: null },
        },
        select: {
            customer_id: true,
            insurance_policy_id: true,
            policy_exclusion_reason: true,
            approved_limit: true,
            approved_limit_currency: true,
            outdated_dcl: true,
            excluded_from_policy: true,
        },
        orderBy: [{ modified_at: "desc" }, { id: "desc" }],
    });
}

/** Root active CustomerPolicy (latest wins) + root-owned active top-ups. */
async function loadRootLimitInputs(
    accountId: number,
    rootIds: readonly number[],
    today: Date,
    dbClient: DbClient
): Promise<RootLimitInputs> {
    const [policies, topUpsByOwnerId] = await Promise.all([
        loadRootActivePolicies(rootIds, dbClient),
        loadActiveTopUpsByCustomerIdForAccount(accountId, today, dbClient, {
            customerIds: rootIds,
        }),
    ]);
    const policyByRootId = new Map<number, RootPolicyRow>();
    for (const policy of policies) {
        if (!policyByRootId.has(policy.customer_id)) {
            policyByRootId.set(policy.customer_id, policy);
        }
    }
    return { policyByRootId, topUpsByOwnerId };
}

function mergeRootLimitInputs(
    a: RootLimitInputs,
    b: RootLimitInputs
): RootLimitInputs {
    return {
        policyByRootId: new Map([...a.policyByRootId, ...b.policyByRootId]),
        topUpsByOwnerId: new Map([...a.topUpsByOwnerId, ...b.topUpsByOwnerId]),
    };
}

/**
 * Root active CustomerPolicy → waterfall scope, same inputs as the as-of
 * dashboard overlay (base limit + active top-ups; outdated DCL / at-risk cohort
 * zero the gaps).
 */
async function buildLiveWaterfallScopes(
    rootIds: readonly number[],
    { policyByRootId, topUpsByOwnerId }: RootLimitInputs,
    accountCurrency: string | null,
    today: Date
): Promise<Map<number, NetCapacityGapWaterfallScope & { policyId: number }>> {
    const scopes = new Map<
        number,
        NetCapacityGapWaterfallScope & { policyId: number }
    >();
    await Promise.all(
        rootIds.map(async (rootId) => {
            const policy = policyByRootId.get(rootId);
            if (policy == null) {
                return;
            }
            scopes.set(
                rootId,
                await resolveLiveWaterfallScope(
                    policy,
                    topUpsByOwnerId.get(rootId) ?? [],
                    accountCurrency,
                    today
                )
            );
        })
    );
    return scopes;
}

async function resolveLiveWaterfallScope(
    policy: RootPolicyRow,
    topUps: TopUpRowForResolution[],
    accountCurrency: string | null,
    today: Date
): Promise<NetCapacityGapWaterfallScope & { policyId: number }> {
    const policyId = policy.insurance_policy_id!;
    const limitCurrency =
        policy.approved_limit_currency?.trim().toUpperCase() ||
        accountCurrency;
    const atRiskCohort = isAtRiskExposureCustomer({
        hasLinkedPolicy: hasActiveLinkedPolicy(policyId),
        exclusionReason: policy.policy_exclusion_reason ?? null,
    });
    let effectiveLimit = Math.max(0, Number(policy.approved_limit ?? 0));
    if (
        policy.approved_limit != null &&
        policy.outdated_dcl !== true &&
        policy.excluded_from_policy !== true
    ) {
        const resolved = await resolveEffectiveApprovedLimitFromTopUpRows(
            topUps,
            {
                baseApprovedLimit: policy.approved_limit,
                baseApprovedLimitCurrency: limitCurrency,
                outdatedDcl: false,
                excludedFromPolicy: false,
                parentPrimaryPolicyId: policyId,
                asOfDate: today,
            }
        );
        effectiveLimit = Math.max(
            0,
            Number(resolved.effectiveApprovedLimit ?? effectiveLimit)
        );
    }
    return {
        policyId,
        effectiveLimit,
        limitCurrency,
        zeroGaps: atRiskCohort || policy.outdated_dcl === true,
    };
}
