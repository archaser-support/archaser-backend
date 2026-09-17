import * as fs from "fs";
import * as path from "path";
import type { PrismaClient } from "@prisma/client";

/**
 * Customer due/overdue rollups still live in the api service
 * (`api/dist/customers/domain/recalculateCustomerAmounts.js`) until extracted
 * into a shared leaf package (same situation as pre–credit-insurance-domain).
 *
 * Deploy contract:
 * - Staging/production images that run billing sync (worker, connectors, or
 *   cron that calls `recalculateCustomerAmountsViaHost`) must include the
 *   compiled api customers domain under the monorepo (`api/dist/customers/...`),
 *   OR set `CUSTOMERS_DOMAIN_ROOT` to that directory (absolute or cwd-relative).
 * - Prefer registering `registerCustomerBalancesFinal` at process boot with a
 *   normal import of the compiled module (Nest API already does this). Dynamic
 *   resolution below is the fallback for hosts that cannot import `api` directly.
 * - Missing module / unresolvable root **throws** — never silent skip.
 */

const MODULE_RELATIVE = path.join(
    "domain",
    "recalculateCustomerAmounts.js"
);

export type RecalculateCustomerAmountsHostOptions = {
    onProgress?: (progress: {
        processed: number;
        total: number;
    }) => void;
    concurrency?: number;
    progressEvery?: number;
};

export type RecalculateCustomerAmountsModule = {
    recalculateCustomerAmounts: (
        ids: number[],
        db: PrismaClient,
        opts?: RecalculateCustomerAmountsHostOptions
    ) => Promise<unknown>;
    calculateOutstandingAmountsForCustomers: (
        ids: number[],
        db: PrismaClient
    ) => Promise<
        Map<
            number,
            {
                total_outstanding_amount: number;
                no_of_overdue_invoices: number;
                customer_currency1: string | null;
                customer_outstanding_amount1: number;
                customer_currency2: string | null;
                customer_outstanding_amount2: number;
            }
        >
    >;
};

export type CustomerBalancesFinalFn = (
    customerIds: number[],
    prisma: PrismaClient,
    options?: RecalculateCustomerAmountsHostOptions
) => Promise<void>;

let registeredBalancesFinal: CustomerBalancesFinalFn | undefined;
let cachedModule: RecalculateCustomerAmountsModule | undefined;
let cachedRoot: string | undefined;

/**
 * Host-supplied rollup entry (Nest imports api customers domain; worker/connectors
 * may register after a successful dynamic load). When set, ViaHost skips path walk.
 */
export function registerCustomerBalancesFinal(
    fn: CustomerBalancesFinalFn
): void {
    registeredBalancesFinal = fn;
}

export function isCustomerBalancesFinalRegistered(): boolean {
    return registeredBalancesFinal !== undefined;
}

export function resetCustomerBalancesFinalForTests(): void {
    registeredBalancesFinal = undefined;
    cachedModule = undefined;
    cachedRoot = undefined;
}

function uniquePreserveOrder(paths: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of paths) {
        const resolved = path.resolve(p);
        if (seen.has(resolved)) {
            continue;
        }
        seen.add(resolved);
        out.push(resolved);
    }
    return out;
}

/** Collect known monorepo / cwd / __dirname layouts for api customers dist. */
function candidateCustomersDomainRoots(): string[] {
    const candidates: string[] = [];

    // packages/billing-connector/dist/customers → ../../../../api/dist/customers
    candidates.push(path.resolve(__dirname, "../../../../api/dist/customers"));
    // packages/billing-connector/dist → ../../../api/dist/customers
    candidates.push(path.resolve(__dirname, "../../../api/dist/customers"));
    // packages/cron-jobs/dist-style depth if this file is ever rehomed
    candidates.push(path.resolve(__dirname, "../../api/dist/customers"));

    const cwd = process.cwd();
    candidates.push(path.resolve(cwd, "api/dist/customers"));
    candidates.push(path.resolve(cwd, "dist/customers"));

    for (const start of [__dirname, cwd]) {
        let dir = path.resolve(start);
        for (let i = 0; i < 8; i++) {
            candidates.push(path.join(dir, "api", "dist", "customers"));
            const parent = path.dirname(dir);
            if (parent === dir) {
                break;
            }
            dir = parent;
        }
    }

    return uniquePreserveOrder(candidates);
}

function modulePathForRoot(root: string): string {
    return path.join(root, MODULE_RELATIVE);
}

/**
 * Resolve the customers domain root. Prefers CUSTOMERS_DOMAIN_ROOT (authoritative
 * when set — a bad override throws), then the first candidate whose recalculate
 * module file exists. Throws if none match.
 */
export function resolveCustomersDomainRoot(): string {
    if (cachedRoot) {
        return cachedRoot;
    }
    const envRoot = process.env.CUSTOMERS_DOMAIN_ROOT?.trim();
    if (envRoot) {
        const root = path.resolve(envRoot);
        const full = modulePathForRoot(root);
        if (!fs.existsSync(full)) {
            throw new Error(
                `CUSTOMERS_DOMAIN_ROOT is set but rollup module is missing at ${full}. ` +
                    "Point it at api/dist/customers (directory that contains domain/recalculateCustomerAmounts.js)."
            );
        }
        cachedRoot = root;
        return root;
    }
    const candidates = candidateCustomersDomainRoots();
    const tried: string[] = [];
    for (const root of candidates) {
        const full = modulePathForRoot(root);
        tried.push(full);
        if (fs.existsSync(full)) {
            cachedRoot = root;
            return root;
        }
    }
    throw new Error(
        [
            "Customer rollup module not found (recalculateCustomerAmounts).",
            "Deploy must ship api/dist/customers (or set CUSTOMERS_DOMAIN_ROOT to that directory).",
            `Tried: ${tried.join("; ")}`,
        ].join(" ")
    );
}

/**
 * Load (and cache) the compiled customers rollup module. Throws if the root
 * cannot be resolved or require fails.
 */
export function loadRecalculateCustomerAmountsModule(): RecalculateCustomerAmountsModule {
    if (cachedModule) {
        return cachedModule;
    }
    const root = resolveCustomersDomainRoot();
    const full = modulePathForRoot(root);
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(full) as RecalculateCustomerAmountsModule;
        if (typeof mod?.recalculateCustomerAmounts !== "function") {
            throw new Error(
                `Module at ${full} does not export recalculateCustomerAmounts`
            );
        }
        cachedModule = mod;
        return mod;
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
            `Failed to load customer rollup module at ${full}: ${reason}. ` +
                "Set CUSTOMERS_DOMAIN_ROOT to api/dist/customers or ensure the api workspace is built into the image."
        );
    }
}

/**
 * Boot / first-sync gate: rollup refresh must be reachable before Payment or
 * pending closes run. Succeeds when a host callback is registered or the
 * dynamic module loads.
 */
export function assertCustomerRollupHostLoadable(): void {
    if (registeredBalancesFinal) {
        return;
    }
    loadRecalculateCustomerAmountsModule();
}

/**
 * Default post-ingest rollup refresh used when the host does not pass
 * onCustomerBalancesFinal (queue worker, scheduled sync, internal inline).
 */
export async function recalculateCustomerAmountsViaHost(
    customerIds: number[],
    prisma: PrismaClient,
    options?: RecalculateCustomerAmountsHostOptions
): Promise<void> {
    if (customerIds.length === 0) {
        return;
    }
    if (registeredBalancesFinal) {
        await registeredBalancesFinal(customerIds, prisma, options);
        return;
    }
    const mod = loadRecalculateCustomerAmountsModule();
    await mod.recalculateCustomerAmounts(customerIds, prisma, options);
}
