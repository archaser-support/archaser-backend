import {
    DEFAULT_AVG_OPEN_INVOICES_PER_CUSTOMER,
    DEFAULT_CUSTOMER_COUNT,
    DEFAULT_SMOKE_WINDOW_DAYS,
    DEFAULT_USD_CUSTOMER_PCT,
    DEFAULT_WINDOW_DAYS,
    SAMPLE_ACCOUNT_SUBDOMAIN,
} from "./constants";
import type { ScriptConfig } from "./types";

function parsePositiveInt(value: string, flag: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}

export function printHelp(): void {
    console.log(`Credit reporting sample data generator (dev only)

Usage:
  npx tsx scripts/testing/generate-credit-reporting-sample-data.ts [options]

Options:
  --confirm                 Required for wipe/write operations
  --dry-run                 Print planned counts without database writes
  --verify                  Post-run black-box checks (read-only; no --confirm needed)
  --repair-kpis             Restamp limit assessment, gap sync, and dashboard snapshots on existing data
  --days <N>                History window length in UTC days (default: ${DEFAULT_WINDOW_DAYS}; verify default: ${DEFAULT_SMOKE_WINDOW_DAYS})
  --resume-from <YYYY-MM-DD>  Continue from the day after the checkpoint date
  --customers <N>           Target customer count (default: ${DEFAULT_CUSTOMER_COUNT})
  --invoices-per-customer <N>  Average open invoices per customer (default: ${DEFAULT_AVG_OPEN_INVOICES_PER_CUSTOMER})
  --usd-customer-pct <N>    Percent of USD-primary customers (default: ${DEFAULT_USD_CUSTOMER_PCT})
  --help, -h                Show this help

Safety:
  - Refuses destructive work when NODE_ENV=production
  - Requires --confirm for wipe/write (except --help, --dry-run, --verify, and --repair-kpis with --confirm)

Account:
  - Fixed subdomain: ${SAMPLE_ACCOUNT_SUBDOMAIN}
  - Credit-only (has_credit_insurance), ILS, Payment-Based
  - Admin user (first run): credit-reporting@dev.local / CreditReportingDev123!

Login URL:
  - Production: https://${SAMPLE_ACCOUNT_SUBDOMAIN}.archaser.com
  - Local dev: http://localhost:3000 (or NEXTAUTH_URL)

Smoke workflow (manual / optional CI):
  1. npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --confirm --days 7
  2. npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --verify
  3. Expect exit 0 and PASS for all verify checks

Post-run verify invariants (order-of-magnitude unless noted):
  - Account subdomain is ${SAMPLE_ACCOUNT_SUBDOMAIN} with has_credit_insurance
  - Customer count matches scheduler target for the run window
  - CustomerPolicyTrend rows ≈ days × active customers
  - InsurancePolicyTrend rows ≥ days × 2 policies
  - CreditDashboardDailySnapshot rows ≈ days × 9 scopes
  - Active top-up count matches scheduler plan
  - Each customer's invoices use a single currency (ILS or USD per profile)
  - 0 customers with gap-sync missingRate after final-style sync

Dry-run workflow:
  npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --dry-run --days 30
  - Exit 0, no DB writes
  - Planned counts must match scheduler presets (stable internal assertions)

Examples:
  npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --dry-run --days 30
  npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --confirm --days 7
  npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --verify
  npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --confirm --days 180
`);
}

export function parseArgs(argv: string[]): ScriptConfig | null {
    if (argv.includes("--help") || argv.includes("-h")) {
        printHelp();
        return null;
    }

    const verify = argv.includes("--verify");
    const repairKpis = argv.includes("--repair-kpis");

    const config: ScriptConfig = {
        confirm: argv.includes("--confirm"),
        dryRun: argv.includes("--dry-run"),
        verify,
        repairKpis,
        days: verify ? DEFAULT_SMOKE_WINDOW_DAYS : DEFAULT_WINDOW_DAYS,
        customers: DEFAULT_CUSTOMER_COUNT,
        invoicesPerCustomer: DEFAULT_AVG_OPEN_INVOICES_PER_CUSTOMER,
        usdCustomerPct: DEFAULT_USD_CUSTOMER_PCT,
    };

    if (config.dryRun && config.verify) {
        throw new Error("--dry-run and --verify cannot be used together");
    }
    if (config.confirm && config.verify) {
        throw new Error("--confirm and --verify cannot be used together");
    }
    if (config.repairKpis && (config.dryRun || config.verify)) {
        throw new Error("--repair-kpis cannot be combined with --dry-run or --verify");
    }
    if (config.repairKpis && config.resumeFrom) {
        throw new Error("--repair-kpis cannot be combined with --resume-from");
    }

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        switch (arg) {
            case "--days":
                if (!next) throw new Error("--days requires a value");
                config.days = parsePositiveInt(next, "--days");
                i++;
                break;
            case "--resume-from":
                if (!next) throw new Error("--resume-from requires a value");
                config.resumeFrom = next;
                i++;
                break;
            case "--customers":
                if (!next) throw new Error("--customers requires a value");
                config.customers = parsePositiveInt(next, "--customers");
                i++;
                break;
            case "--invoices-per-customer":
                if (!next) {
                    throw new Error("--invoices-per-customer requires a value");
                }
                config.invoicesPerCustomer = parsePositiveInt(
                    next,
                    "--invoices-per-customer"
                );
                i++;
                break;
            case "--usd-customer-pct":
                if (!next) throw new Error("--usd-customer-pct requires a value");
                config.usdCustomerPct = parsePositiveInt(
                    next,
                    "--usd-customer-pct"
                );
                i++;
                break;
            case "--confirm":
            case "--dry-run":
            case "--verify":
            case "--repair-kpis":
                break;
            default:
                if (arg.startsWith("-")) {
                    throw new Error(`Unknown option: ${arg}`);
                }
        }
    }

    return config;
}

export function assertSafetyGuards(config: ScriptConfig): void {
    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "Refusing to run: NODE_ENV is production. Use a local development database."
        );
    }

    if (!config.dryRun && !config.confirm && !config.verify && !config.repairKpis) {
        throw new Error(
            "Refusing to run destructive work without --confirm. Use --dry-run to preview planned counts, --verify for post-run checks, or --repair-kpis --confirm to fix KPIs on existing data."
        );
    }

    if (config.repairKpis && !config.confirm) {
        throw new Error("--repair-kpis requires --confirm");
    }
}
