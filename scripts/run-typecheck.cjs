/**
 * Workspace typecheck for husky / local use.
 * Mirrors .github/workflows/typecheck.yml (libs build + app tsc --noEmit).
 */
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");

function run(command, args, label) {
    console.error(`[type-check] ${label}`);
    const result = spawnSync(command, args, {
        cwd: root,
        stdio: "inherit",
        shell: process.platform === "win32",
        env: {
            ...process.env,
            // prisma generate may run via workspace builds; schema needs a URL
            DATABASE_URL:
                process.env.DATABASE_URL ||
                "postgresql://ci:ci@127.0.0.1:5432/ci",
        },
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

const libWorkspaces = [
    "@archaser/database",
    "@archaser/sms-send",
    "@archaser/auth",
    "@archaser/credit-insurance-domain",
    "@archaser/billing-connector",
    "@archaser/cron-jobs",
];

for (const workspace of libWorkspaces) {
    run("npm", ["run", "build", "-w", workspace], `build ${workspace}`);
}

const appTsconfigs = [
    "api/tsconfig.json",
    "worker/tsconfig.json",
    "sms/tsconfig.json",
    "connectors/tsconfig.json",
    "reports/tsconfig.json",
];

for (const tsconfig of appTsconfigs) {
    run(
        "npx",
        ["tsc", "--noEmit", "-p", tsconfig],
        `tsc --noEmit -p ${tsconfig}`
    );
}

console.error("[type-check] ok");
