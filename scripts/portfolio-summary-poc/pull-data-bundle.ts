/**
 * Portfolio summary POC — pull the Portfolio Health data bundle for one account
 * and date range, using the same services the dashboard calls:
 *
 * - Health / No coverage / Utilization / Costs: `getCreditPortfolioHealth`
 *   (GET /api/credit-insurance/portfolio-health) with the dashboard default
 *   scope minus no-policy exposure: no policy filter, all business units,
 *   account-wide access (admin-style, no BU restriction).
 * - Policy summary tab: `InsuranceEntitiesService.list` / `getById`
 *   (GET /api/entities/insurance-policies[/:id]) and
 *   `ClaimsService.policyExcessSummary` with the tab's `recent_years=3`.
 *
 * The bundle holds real customer data — it is written only to the gitignored
 * `.scratch/portfolio-summary-poc/` folder.
 *
 * Usage:
 *   npx tsx --tsconfig api/tsconfig.json scripts/portfolio-summary-poc/pull-data-bundle.ts \
 *     --account 10149 --from 2026-04-01 --to 2026-09-30
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";

import { bindCreditInsurancePrisma } from "@archaser/credit-insurance-domain";

import type {
    AccessScopeService,
    AccessUserInfo,
} from "../../api/src/auth/access-scope.service";
import type { JwtPayload } from "../../api/src/auth/auth.service";
import { serializeBigInt } from "../../api/src/common/serialize-bigint";
import { ClaimsService } from "../../api/src/credit-insurance/claims.service";
import {
    getCreditPortfolioHealth,
    parsePortfolioHealthDateRange,
} from "../../api/src/credit-insurance/domain/creditPortfolioHealthService";
import { InsuranceEntitiesService } from "../../api/src/credit-insurance/insurance-entities.service";
import type { DatabaseService } from "../../api/src/database/database.service";

export const BUNDLE_VERSION = 1;
const OUTPUT_DIR = path.resolve(
    __dirname,
    "../../.scratch/portfolio-summary-poc"
);
const POLICY_SUMMARY_RECENT_YEARS = 3;

type CliArgs = { accountId: number; from: string; to: string };

function readFlag(argv: string[], name: string): string | undefined {
    const index = argv.indexOf(name);
    if (index === -1) {
        return undefined;
    }
    const value = argv[index + 1];
    return value != null && !value.startsWith("--") ? value : undefined;
}

function isRealCalendarDate(ymd: string): boolean {
    const date = new Date(`${ymd}T00:00:00.000Z`);
    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === ymd
    );
}

function parseArgs(argv: string[]): CliArgs {
    const accountRaw = readFlag(argv, "--account");
    const from = readFlag(argv, "--from");
    const to = readFlag(argv, "--to");
    if (!accountRaw || !from || !to) {
        throw new Error(
            "Usage: --account <id> --from <YYYY-MM-DD> --to <YYYY-MM-DD>"
        );
    }
    const accountId = Number(accountRaw);
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new Error(`--account must be a positive integer (got "${accountRaw}")`);
    }
    for (const [flag, value] of [
        ["--from", from],
        ["--to", to],
    ] as const) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !isRealCalendarDate(value)) {
            throw new Error(`${flag} must be a real date in YYYY-MM-DD (got "${value}")`);
        }
    }
    const parsed = parsePortfolioHealthDateRange(from, to);
    if ("error" in parsed) {
        throw new Error(parsed.error);
    }
    return { accountId, from: parsed.from, to: parsed.to };
}

/**
 * Account-wide access for the Nest services: the effective account is the
 * target account and no view-as / BU narrowing applies.
 */
function scriptAccessScope(accountId: number): AccessScopeService {
    const userInfo: AccessUserInfo = {
        userId: "portfolio-summary-poc",
        accountId,
        role: "Admin",
        businessUnitId: null,
    };
    return {
        resolveUserInfo: async () => userInfo,
        getEffectiveAccountId: (info: AccessUserInfo) =>
            info.viewAsUserAccountId || info.accountId,
    } as unknown as AccessScopeService;
}

type PolicyListRow = {
    id: number;
    policy_number: string | null;
    status?: string | null;
    policy_kind?: string | null;
};

type PolicyDetail = Record<string, unknown> & {
    id: number;
    policy_kind?: string | null;
    InsurancePolicyCountry?: unknown[] | null;
    NamedPolicy?: unknown[] | null;
};

async function loadPolicySummaries(
    db: DatabaseService,
    accessScope: AccessScopeService,
    user: JwtPayload
) {
    const insurance = new InsuranceEntitiesService(db, accessScope);
    const claims = new ClaimsService(db, accessScope);

    const list = (await insurance.list("insurance-policies", user, {})) as {
        policies?: PolicyListRow[];
    };
    const policies = list.policies ?? [];

    const summaries = [];
    for (const policy of policies) {
        const detail = (await insurance.getById(
            "insurance-policies",
            user,
            policy.id
        )) as PolicyDetail;
        const { InsurancePolicyCountry, NamedPolicy, ...terms } = detail;

        let claimsExcess: unknown = null;
        let claimsExcessError: string | null = null;
        if (detail.policy_kind !== "TopUp") {
            try {
                claimsExcess = await claims.policyExcessSummary(user, {
                    insurance_policy_id: String(policy.id),
                    recent_years: String(POLICY_SUMMARY_RECENT_YEARS),
                    include_claims: "true",
                });
            } catch (error) {
                claimsExcessError =
                    error instanceof Error ? error.message : String(error);
            }
        }

        summaries.push({
            terms,
            countryCount: Array.isArray(InsurancePolicyCountry)
                ? InsurancePolicyCountry.length
                : 0,
            namedCount: Array.isArray(NamedPolicy) ? NamedPolicy.length : 0,
            claimsExcess,
            claimsExcessError,
        });
    }
    return { policies, summaries };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);
    const db = prisma as unknown as DatabaseService;

    try {
        const account = await prisma.account.findUnique({
            where: { id: args.accountId },
            select: {
                id: true,
                name: true,
                currency: true,
                has_credit_insurance: true,
            },
        });
        if (!account) {
            throw new Error(`Account ${args.accountId} not found`);
        }
        if (!account.has_credit_insurance) {
            throw new Error(
                `Account ${args.accountId} does not have credit insurance enabled`
            );
        }

        console.log(
            `[portfolio-summary-poc] account ${account.id}, ${args.from} → ${args.to}`
        );

        const scope = {
            policyId: null,
            businessUnitId: null,
            includeNoPolicyExposure: false,
            accessibleBusinessUnitIds: null,
            isAdmin: true,
        } as const;

        const health = await getCreditPortfolioHealth(account.id, {
            from: args.from,
            to: args.to,
            policyId: undefined,
            businessUnitFilter: {},
            includeNoPolicyExposure: scope.includeNoPolicyExposure,
            selectedBusinessUnitId: null,
            accessibleBusinessUnitIds: scope.accessibleBusinessUnitIds,
            isAdmin: scope.isAdmin,
        });
        if ("error" in health) {
            throw new Error(`portfolio-health: ${health.error}`);
        }
        console.log(
            `[portfolio-summary-poc] portfolio health: ${health.daysAvailable}/${health.daysInRange} days with data`
        );

        const accessScope = scriptAccessScope(account.id);
        const user = {
            sub: "portfolio-summary-poc",
            username: "portfolio-summary-poc",
            account_id: account.id,
        } as JwtPayload;
        const policySummary = await loadPolicySummaries(db, accessScope, user);
        console.log(
            `[portfolio-summary-poc] policy summary: ${policySummary.summaries.length} policies`
        );

        const bundle = serializeBigInt({
            bundleVersion: BUNDLE_VERSION,
            generatedAt: new Date().toISOString(),
            account: {
                id: account.id,
                name: account.name,
                currency: account.currency,
            },
            range: { from: health.from, to: health.to },
            daysAvailable: health.daysAvailable,
            daysInRange: health.daysInRange,
            scope,
            policySummary: {
                recentYears: POLICY_SUMMARY_RECENT_YEARS,
                policies: policySummary.policies,
                details: policySummary.summaries,
            },
            portfolioHealth: health.portfolioHealth,
            noCoverage: health.noCoverage,
            utilization: health.utilization,
            costs: health.costs,
        });

        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        const outFile = path.join(
            OUTPUT_DIR,
            `bundle-${account.id}-${args.from}_${args.to}.json`
        );
        fs.writeFileSync(outFile, `${JSON.stringify(bundle, null, 2)}\n`);
        console.log(`[portfolio-summary-poc] wrote ${outFile}`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    console.error(
        `[portfolio-summary-poc] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
});
