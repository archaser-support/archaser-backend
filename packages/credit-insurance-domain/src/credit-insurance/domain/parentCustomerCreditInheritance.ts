/**
 * Parent/child shared credit-policy pool: resolve root, mirror root active +
 * pending CustomerPolicy onto descendants, and react to parent_customer_id changes.
 *
 * Credit side effects run only when the account has credit insurance.
 * Group capacity-gap / invoice waterfall lives in the gap pipeline; this module
 * mirrors policy *settings* onto descendants. Capacity-gap snapshot fields on
 * linked children are forced to 0 (pool gap lives on the root only).
 */
import type { CustomerPolicy, Prisma } from "@prisma/client";

import { prisma, type DbClient } from "../domain-db";
import { syncCustomerInsuranceFields } from "./syncCustomerInsuranceFields";

const MAX_PARENT_WALK_DEPTH = 50;

/**
 * Request-scoped memo for root / descendant walks so parent-change sync,
 * attribution, and open-AR rollup do not re-query the same tree edges.
 */
export type CreditPoolMembershipCache = {
    rootByCustomerId: Map<number, number>;
    descendantsByCustomerId: Map<number, number[]>;
};

export function createCreditPoolMembershipCache(): CreditPoolMembershipCache {
    return {
        rootByCustomerId: new Map(),
        descendantsByCustomerId: new Map(),
    };
}

/**
 * One account query of parent links, then fill root/descendant maps in memory.
 * Dashboard KPI expansion used to run one descendant query per root (~N round-trips).
 */
export async function hydrateCreditPoolMembershipCacheForAccount(
    accountId: number,
    dbClient: DbClient = prisma,
    cache: CreditPoolMembershipCache = createCreditPoolMembershipCache()
): Promise<CreditPoolMembershipCache> {
    const rows = await dbClient.customer.findMany({
        where: { account_id: accountId },
        select: { id: true, parent_customer_id: true },
    });
    const parentById = new Map<number, number | null>();
    const childrenByParent = new Map<number, number[]>();
    for (const row of rows) {
        parentById.set(row.id, row.parent_customer_id ?? null);
        if (row.parent_customer_id != null) {
            const list = childrenByParent.get(row.parent_customer_id) ?? [];
            list.push(row.id);
            childrenByParent.set(row.parent_customer_id, list);
        }
    }

    const rootMemo = new Map<number, number>();
    const resolveRoot = (startId: number): number => {
        const already = rootMemo.get(startId);
        if (already != null) {
            return already;
        }
        const path: number[] = [];
        let currentId = startId;
        const seen = new Set<number>();
        while (parentById.has(currentId)) {
            if (seen.has(currentId)) {
                break;
            }
            const memo = rootMemo.get(currentId);
            if (memo != null) {
                currentId = memo;
                break;
            }
            seen.add(currentId);
            path.push(currentId);
            const parentId = parentById.get(currentId);
            if (parentId == null || !parentById.has(parentId)) {
                break;
            }
            currentId = parentId;
        }
        for (const id of path) {
            rootMemo.set(id, currentId);
            cache.rootByCustomerId.set(id, currentId);
        }
        rootMemo.set(currentId, currentId);
        cache.rootByCustomerId.set(currentId, currentId);
        return currentId;
    };

    const descendantsOf = (rootId: number): number[] => {
        const result: number[] = [];
        const stack = [...(childrenByParent.get(rootId) ?? [])];
        const seen = new Set<number>([rootId]);
        while (stack.length > 0) {
            const id = stack.pop()!;
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
            result.push(id);
            const children = childrenByParent.get(id);
            if (children) {
                stack.push(...children);
            }
        }
        return result;
    };

    for (const id of parentById.keys()) {
        resolveRoot(id);
        cache.descendantsByCustomerId.set(id, descendantsOf(id));
    }
    return cache;
}

/** Settings copied from root → descendant mirrors. */
const MIRROR_POLICY_FIELD_KEYS = [
    "insurance_policy_id",
    "customer_number_policy",
    "approved_limit",
    "approved_limit_currency",
    "approved_limit_expiration_date",
    "zero_limit_date",
    "limit_type",
    "max_payment_term",
    "max_allowed_mep",
    "reporting_days",
    "mep_cutoff_day",
    "mep_substitute_extra_days",
    "reporting_cutoff_day",
    "reporting_substitute_extra_days",
    "payment_term_cutoff_day",
    "payment_term_substitute_day",
    "excluded_from_policy",
    "policy_exclusion_reason",
    "credit_score",
    "credit_score_input_date",
    "active_customer_since",
    "outdated_dcl",
    "cost_percent",
    "registration_fee_percent",
    "policy_change_start_date",
    "capacity_gap_amount",
    "capacity_gap_amount_date",
    "retained_capacity_gap",
    "uninsured_amount",
    "capacity_gap_amount1",
    "capacity_gap_currency1",
    "capacity_gap_amount2",
    "capacity_gap_currency2",
    "uninsured_amount1",
    "uninsured_currency1",
    "uninsured_amount2",
    "uninsured_currency2",
] as const;

/**
 * Gap card fields forced to null/0 on linked children (pool gap is root-only).
 * Still listed in {@link MIRROR_POLICY_FIELD_KEYS} for snapshot compare keys.
 */
const CHILD_ZEROED_CAPACITY_GAP_FIELD_KEYS = [
    "capacity_gap_amount",
    "capacity_gap_amount_date",
    "retained_capacity_gap",
    "capacity_gap_amount1",
    "capacity_gap_currency1",
    "capacity_gap_amount2",
    "capacity_gap_currency2",
] as const;

type MirrorPolicyFieldKey = (typeof MIRROR_POLICY_FIELD_KEYS)[number];

function childZeroedCapacityGapWriteData(): Record<string, null> {
    const data: Record<string, null> = {};
    for (const key of CHILD_ZEROED_CAPACITY_GAP_FIELD_KEYS) {
        data[key] = null;
    }
    return data;
}

export type ParentCustomerCreditInheritanceOptions = {
    dbClient?: DbClient;
    userId?: string | null;
    /** Skip live insurance sync after mirror (import batching). Default false. */
    skipInsuranceSync?: boolean;
};

function serializeComparable(value: unknown): string {
    if (value == null) {
        return "";
    }
    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === "object" && value !== null && "toString" in value) {
        return String(value);
    }
    return String(value);
}

function policyMirrorSnapshot(
    row: Partial<CustomerPolicy> | null | undefined
): Record<MirrorPolicyFieldKey, string> | null {
    if (!row) {
        return null;
    }
    const out = {} as Record<MirrorPolicyFieldKey, string>;
    for (const key of MIRROR_POLICY_FIELD_KEYS) {
        out[key] = serializeComparable(
            (row as Record<string, unknown>)[key]
        );
    }
    return out;
}

function mirrorSnapshotsEqual(
    a: Record<MirrorPolicyFieldKey, string> | null,
    b: Record<MirrorPolicyFieldKey, string> | null
): boolean {
    if (a == null && b == null) {
        return true;
    }
    if (a == null || b == null) {
        return false;
    }
    for (const key of MIRROR_POLICY_FIELD_KEYS) {
        if (a[key] !== b[key]) {
            return false;
        }
    }
    return true;
}

function expectedDescendantMirrorSnapshot(
    rootRow: Partial<CustomerPolicy> | null | undefined
): Record<MirrorPolicyFieldKey, string> | null {
    const snap = policyMirrorSnapshot(rootRow);
    if (!snap) {
        return null;
    }
    for (const key of CHILD_ZEROED_CAPACITY_GAP_FIELD_KEYS) {
        snap[key] = serializeComparable(null);
    }
    return snap;
}

function pickMirrorWriteData(
    source: CustomerPolicy,
    status: "active" | "pending",
    userId: string | null | undefined
): Prisma.CustomerPolicyUncheckedCreateInput {
    const data: Record<string, unknown> = {
        status,
        is_active: status === "active",
    };
    for (const key of MIRROR_POLICY_FIELD_KEYS) {
        data[key] = source[key];
    }
    Object.assign(data, childZeroedCapacityGapWriteData());
    if (userId) {
        data.created_by = userId;
        data.modified_by = userId;
    }
    return data as Prisma.CustomerPolicyUncheckedCreateInput;
}

/**
 * Walk `parent_customer_id` to the top of the hierarchy (credit pool root).
 */
export async function resolveCustomerCreditPoolRoot(
    customerId: number,
    dbClient: DbClient = prisma,
    cache?: CreditPoolMembershipCache
): Promise<number> {
    const cachedRoot = cache?.rootByCustomerId.get(customerId);
    if (cachedRoot != null) {
        return cachedRoot;
    }

    const path: number[] = [];
    let currentId = customerId;
    const seen = new Set<number>();

    for (let depth = 0; depth < MAX_PARENT_WALK_DEPTH; depth += 1) {
        if (seen.has(currentId)) {
            if (cache) {
                for (const id of path) {
                    cache.rootByCustomerId.set(id, currentId);
                }
                cache.rootByCustomerId.set(currentId, currentId);
            }
            return currentId;
        }
        seen.add(currentId);

        const memoRoot = cache?.rootByCustomerId.get(currentId);
        if (memoRoot != null) {
            if (cache) {
                for (const id of path) {
                    cache.rootByCustomerId.set(id, memoRoot);
                }
            }
            return memoRoot;
        }

        path.push(currentId);
        const row = await dbClient.customer.findUnique({
            where: { id: currentId },
            select: { parent_customer_id: true },
        });
        if (!row?.parent_customer_id) {
            if (cache) {
                for (const id of path) {
                    cache.rootByCustomerId.set(id, currentId);
                }
            }
            return currentId;
        }
        currentId = row.parent_customer_id;
    }
    if (cache) {
        for (const id of path) {
            cache.rootByCustomerId.set(id, currentId);
        }
        cache.rootByCustomerId.set(currentId, currentId);
    }
    return currentId;
}

/**
 * All descendants of `rootCustomerId` at any depth (excludes the root).
 */
export async function listDescendantCustomerIds(
    rootCustomerId: number,
    accountId: number,
    dbClient: DbClient = prisma,
    cache?: CreditPoolMembershipCache
): Promise<number[]> {
    const cached = cache?.descendantsByCustomerId.get(rootCustomerId);
    if (cached != null) {
        return [...cached];
    }

    const result: number[] = [];
    let frontier = [rootCustomerId];
    const seen = new Set<number>([rootCustomerId]);

    while (frontier.length > 0) {
        const children = await dbClient.customer.findMany({
            where: {
                account_id: accountId,
                parent_customer_id: { in: frontier },
            },
            select: { id: true },
        });
        frontier = [];
        for (const child of children) {
            if (seen.has(child.id)) {
                continue;
            }
            seen.add(child.id);
            result.push(child.id);
            frontier.push(child.id);
        }
    }
    if (cache) {
        cache.descendantsByCustomerId.set(rootCustomerId, [...result]);
    }
    return result;
}

/**
 * Credit pool = root + all descendants. Resolves root by walking parents.
 */
export async function resolveCreditPoolMemberIds(
    customerId: number,
    accountId: number,
    dbClient: DbClient = prisma,
    cache?: CreditPoolMembershipCache
): Promise<{ rootCustomerId: number; memberIds: number[] }> {
    const rootCustomerId = await resolveCustomerCreditPoolRoot(
        customerId,
        dbClient,
        cache
    );
    const descendants = await listDescendantCustomerIds(
        rootCustomerId,
        accountId,
        dbClient,
        cache
    );
    return {
        rootCustomerId,
        memberIds: [rootCustomerId, ...descendants],
    };
}

export async function accountHasCreditInsurance(
    accountId: number,
    dbClient: DbClient = prisma
): Promise<boolean> {
    const account = await dbClient.account.findUnique({
        where: { id: accountId },
        select: { has_credit_insurance: true },
    });
    return account?.has_credit_insurance === true;
}

/** True when the customer is linked under a parent (locked for credit edits). */
export async function isLinkedCreditChild(
    customerId: number,
    dbClient: DbClient = prisma
): Promise<boolean> {
    const row = await dbClient.customer.findUnique({
        where: { id: customerId },
        select: { parent_customer_id: true },
    });
    return row?.parent_customer_id != null;
}

/**
 * Customer whose top-ups apply to the shared effective limit: root when linked,
 * otherwise self.
 */
export async function resolveTopUpOwnerCustomerId(
    customerId: number,
    dbClient: DbClient = prisma,
    cache?: CreditPoolMembershipCache
): Promise<number> {
    return resolveCustomerCreditPoolRoot(customerId, dbClient, cache);
}

async function loadLivePolicies(
    customerId: number,
    dbClient: DbClient
): Promise<{
    active: CustomerPolicy | null;
    pending: CustomerPolicy | null;
}> {
    const rows = await dbClient.customerPolicy.findMany({
        where: {
            customer_id: customerId,
            OR: [{ is_active: true }, { status: "pending" }],
        },
        orderBy: { id: "desc" },
    });
    const active =
        rows.find((row) => row.is_active) ??
        rows.find((row) => row.status === "active") ??
        null;
    const pending = rows.find((row) => row.status === "pending") ?? null;
    return { active, pending };
}

async function deactivateLivePolicies(
    customerId: number,
    userId: string | null | undefined,
    dbClient: DbClient
): Promise<void> {
    await dbClient.customerPolicy.updateMany({
        where: {
            customer_id: customerId,
            OR: [{ is_active: true }, { status: "pending" }],
        },
        data: {
            is_active: false,
            status: "inactive",
            ...(userId ? { modified_by: userId } : {}),
        },
    });
}

async function mirrorRootOntoOneDescendant(args: {
    descendantId: number;
    rootActive: CustomerPolicy | null;
    rootPending: CustomerPolicy | null;
    userId?: string | null;
    dbClient: DbClient;
    skipInsuranceSync?: boolean;
}): Promise<boolean> {
    const { descendantId, rootActive, rootPending, userId, dbClient } = args;
    const current = await loadLivePolicies(descendantId, dbClient);

    const activeMatches = mirrorSnapshotsEqual(
        policyMirrorSnapshot(current.active),
        expectedDescendantMirrorSnapshot(rootActive)
    );
    const pendingMatches = mirrorSnapshotsEqual(
        policyMirrorSnapshot(current.pending),
        expectedDescendantMirrorSnapshot(rootPending)
    );
    const activeStatusOk =
        (rootActive == null && current.active == null) ||
        (rootActive != null &&
            current.active != null &&
            current.active.is_active === true &&
            current.active.status === "active");
    const pendingStatusOk =
        (rootPending == null && current.pending == null) ||
        (rootPending != null &&
            current.pending != null &&
            current.pending.status === "pending" &&
            current.pending.is_active === false);

    if (activeMatches && pendingMatches && activeStatusOk && pendingStatusOk) {
        return false;
    }

    await deactivateLivePolicies(descendantId, userId, dbClient);

    if (rootActive) {
        await dbClient.customerPolicy.create({
            data: {
                ...pickMirrorWriteData(rootActive, "active", userId),
                customer_id: descendantId,
            } as never,
        });
    }
    if (rootPending) {
        await dbClient.customerPolicy.create({
            data: {
                ...pickMirrorWriteData(rootPending, "pending", userId),
                customer_id: descendantId,
            } as never,
        });
    }

    if (!args.skipInsuranceSync) {
        try {
            await syncCustomerInsuranceFields(descendantId, {
                dbClient,
                validateZeroLimitDate: false,
            });
        } catch {
            // Mirror rows are committed; tip sync can catch up later.
        }
    }
    return true;
}

/**
 * Overwrite every descendant's active + pending policy from the root.
 * Empty root (no active/pending) clears live mirrors on descendants.
 */
export async function remirrorDescendantsFromRoot(
    rootCustomerId: number,
    accountId: number,
    options?: ParentCustomerCreditInheritanceOptions & {
        cache?: CreditPoolMembershipCache;
    }
): Promise<{ mirroredCustomerIds: number[] }> {
    const dbClient = options?.dbClient ?? prisma;
    const descendants = await listDescendantCustomerIds(
        rootCustomerId,
        accountId,
        dbClient,
        options?.cache
    );
    if (descendants.length === 0) {
        return { mirroredCustomerIds: [] };
    }

    const { active: rootActive, pending: rootPending } = await loadLivePolicies(
        rootCustomerId,
        dbClient
    );

    const mirroredCustomerIds: number[] = [];
    for (const descendantId of descendants) {
        const changed = await mirrorRootOntoOneDescendant({
            descendantId,
            rootActive,
            rootPending,
            userId: options?.userId,
            dbClient,
            skipInsuranceSync: options?.skipInsuranceSync,
        });
        if (changed) {
            mirroredCustomerIds.push(descendantId);
        }
    }
    return { mirroredCustomerIds };
}

/**
 * After any customer policy mutation: remirror the credit pool from its root
 * (overwrites linked children; propagates root edits to descendants).
 */
export async function remirrorCreditPoolAfterPolicyMutation(
    customerId: number,
    accountId: number,
    options?: ParentCustomerCreditInheritanceOptions & {
        cache?: CreditPoolMembershipCache;
    }
): Promise<{ rootCustomerId: number; mirroredCustomerIds: number[] }> {
    const dbClient = options?.dbClient ?? prisma;
    if (!(await accountHasCreditInsurance(accountId, dbClient))) {
        return { rootCustomerId: customerId, mirroredCustomerIds: [] };
    }
    const rootCustomerId = await resolveCustomerCreditPoolRoot(
        customerId,
        dbClient,
        options?.cache
    );
    const { mirroredCustomerIds } = await remirrorDescendantsFromRoot(
        rootCustomerId,
        accountId,
        options
    );
    return { rootCustomerId, mirroredCustomerIds };
}

/**
 * Single connect/disconnect side-effect path (UI, API, import/ERP).
 * Caller must already have written `parent_customer_id` on `customerId`.
 *
 * Pipeline: remirror → capacity gaps → CTP+CDP → breach rollup → open-AR rollup
 * (see {@link runCreditPoolParentChangeSideEffects}). Failures throw.
 */
export async function onParentCustomerIdChanged(args: {
    accountId: number;
    customerId: number;
    previousParentId: number | null;
    nextParentId: number | null;
    userId?: string | null;
    dbClient?: DbClient;
    skipInsuranceSync?: boolean;
}): Promise<{
    remirroredRoots: number[];
    mirroredCustomerIds: number[];
    asyncHistoryJob: import("./creditAsOfBackfillJob").CreditAsOfBackfillJobView | null;
}> {
    const dbClient = args.dbClient ?? prisma;

    if (args.previousParentId === args.nextParentId) {
        return {
            remirroredRoots: [],
            mirroredCustomerIds: [],
            asyncHistoryJob: null,
        };
    }
    if (!(await accountHasCreditInsurance(args.accountId, dbClient))) {
        return {
            remirroredRoots: [],
            mirroredCustomerIds: [],
            asyncHistoryJob: null,
        };
    }

    const {
        beginCreditPoolParentChangeSyncProgress,
        failCreditPoolParentChangeSyncProgress,
        setCreditPoolParentChangeSyncStep,
    } = await import("./creditPoolParentChangeProgress");
    await beginCreditPoolParentChangeSyncProgress({
        accountId: args.accountId,
        requestedBy: args.userId ?? null,
        dbClient,
    });

    try {
        // Fresh tree after parent FK write — share across remirror / sync / rollups.
        const cache = createCreditPoolMembershipCache();

        const options: ParentCustomerCreditInheritanceOptions & {
            cache?: CreditPoolMembershipCache;
        } = {
            dbClient,
            userId: args.userId,
            skipInsuranceSync: args.skipInsuranceSync,
            cache,
        };

        const remirroredRoots: number[] = [];
        const mirroredCustomerIds: number[] = [];

        await setCreditPoolParentChangeSyncStep({
            accountId: args.accountId,
            step: "remirror",
            dbClient,
        });

        if (args.nextParentId != null) {
            // Connect / reparent: remirror entire new pool from its root.
            const newRootId = await resolveCustomerCreditPoolRoot(
                args.customerId,
                dbClient,
                cache
            );
            const result = await remirrorDescendantsFromRoot(
                newRootId,
                args.accountId,
                options
            );
            remirroredRoots.push(newRootId);
            mirroredCustomerIds.push(...result.mirroredCustomerIds);

            // If we left an old mid-level tree, remirror that former subtree root
            // only when the previous parent still exists as a distinct pool.
            if (
                args.previousParentId != null &&
                args.previousParentId !== args.nextParentId
            ) {
                const oldRootId = await resolveCustomerCreditPoolRoot(
                    args.previousParentId,
                    dbClient,
                    cache
                );
                if (oldRootId !== newRootId) {
                    const oldResult = await remirrorDescendantsFromRoot(
                        oldRootId,
                        args.accountId,
                        options
                    );
                    remirroredRoots.push(oldRootId);
                    mirroredCustomerIds.push(...oldResult.mirroredCustomerIds);
                }
            }
        } else {
            // Disconnect: leave last mirrored data on this customer; remirror its
            // remaining descendants from it as the new root.
            const result = await remirrorDescendantsFromRoot(
                args.customerId,
                args.accountId,
                options
            );
            remirroredRoots.push(args.customerId);
            mirroredCustomerIds.push(...result.mirroredCustomerIds);

            if (args.previousParentId != null) {
                const oldRootId = await resolveCustomerCreditPoolRoot(
                    args.previousParentId,
                    dbClient,
                    cache
                );
                if (oldRootId !== args.customerId) {
                    const oldResult = await remirrorDescendantsFromRoot(
                        oldRootId,
                        args.accountId,
                        options
                    );
                    remirroredRoots.push(oldRootId);
                    mirroredCustomerIds.push(...oldResult.mirroredCustomerIds);
                }
            }
        }

        const { runCreditPoolParentChangeSideEffects } = await import(
            "./runCreditPoolParentChangeSideEffects"
        );
        const sideEffects = await runCreditPoolParentChangeSideEffects({
            accountId: args.accountId,
            customerId: args.customerId,
            previousParentId: args.previousParentId,
            nextParentId: args.nextParentId,
            remirroredRoots,
            dbClient,
            cache,
            requestedBy: args.userId ?? null,
        });

        return {
            remirroredRoots,
            mirroredCustomerIds,
            asyncHistoryJob: sideEffects.asyncHistoryJob,
        };
    } catch (error) {
        await failCreditPoolParentChangeSyncProgress({
            accountId: args.accountId,
            errorMessage:
                error instanceof Error ? error.message : String(error),
            dbClient,
        });
        throw error;
    }
}
