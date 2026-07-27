/**
 * Copy credit-insurance domain sources into Nest and rewrite imports for Nest build.
 * Run from repo root: node backend/api/scripts/port-ci-domain.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "frontend/server/services/creditInsurance");
const DEST = path.join(ROOT, "backend/api/src/credit-insurance/domain");
const SHARED_SRC = path.join(ROOT, "frontend/shared/creditInsurance");
const SHARED_DEST = path.join(DEST, "shared");

const SKIP = new Set([
    "creditDashboardApiAccess.ts",
    "NamedPolicyAssignmentService.ts",
    "CustomerPolicyService.ts",
    "AutoAssignPendingReviewDclService.ts",
    "CreditNotificationEmailService.ts",
    "NotificationRuleDeliveryService.ts",
    "NotificationRuleEvaluator.ts",
    "NotificationDeliveryLogService.ts",
    "NotificationRuleSetService.ts",
    "syncCustomerInsuranceFields.ts",
    "CustomerTopUpService.ts",
    "postImportOverdueMetrics.ts",
]);

const SHARED_FILES = fs
    .readdirSync(SHARED_SRC)
    .filter((f) => f.endsWith(".ts"));

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function rewrite(content, kind) {
    let out = content;
    out = out.replace(
        /import \{ prismaCron \} from ["']@\/lib\/prisma["'];?\r?\n/g,
        ""
    );
    out = out.replace(/const prisma = prismaCron\(\);\r?\n/g, "");
    out = out.replace(
        /from ["']@\/lib\/prisma["']/g,
        'from "../domain-db"'
    );
    out = out.replace(
        /from ["']@\/shared\/creditInsurance\/([^"']+)["']/g,
        'from "./shared/$1"'
    );
    out = out.replace(
        /from ["']@\/server\/services\/creditInsurance\/([^"']+)["']/g,
        'from "./$1"'
    );
    out = out.replace(
        /from ["']@\/utils\/stringFormatters["']/g,
        'from "./stringFormatters-stub"'
    );
    out = out.replace(
        /from ["']@\/utils\/serializeBigInt["']/g,
        'from "../serialize-bigint-local"'
    );
    out = out.replace(
        /from ["']@\/server\/utils\/reportCustomerPolicyFields["']/g,
        'from "./reportCustomerPolicyFields-stub"'
    );
    out = out.replace(
        /from ["']@\/server\/services\/ReportExecutionService\.virtualFields["']/g,
        'from "./reportExecutionVirtualFields-stub"'
    );
    // Keep Prisma enums/types from @prisma/client (package re-export is incomplete)
    // out = out.replace(/from ["']@prisma\/client["']/g, 'from "@archaser/database"');
    out = out.replace(/prismaCron\(\)/g, "prisma");
    if (kind === "shared") {
        out = out.replace(/from ["']\.\/shared\/([^"']+)["']/g, 'from "./$1"');
        out = out.replace(
            /from ["']\.\.\/domain-db["']/g,
            'from "../../domain-db"'
        );
    }
    return out;
}

ensureDir(DEST);
ensureDir(SHARED_DEST);

// Keep hand-written stubs
const keep = new Set([
    "stringFormatters-stub.ts",
    "reportCustomerPolicyFields-stub.ts",
    "reportExecutionVirtualFields-stub.ts",
]);

for (const file of fs.readdirSync(SRC)) {
    if (!file.endsWith(".ts") || SKIP.has(file)) continue;
    const raw = fs.readFileSync(path.join(SRC, file), "utf8");
    fs.writeFileSync(path.join(DEST, file), rewrite(raw, "domain"));
    console.log("ported", file);
}

for (const file of SHARED_FILES) {
    const raw = fs.readFileSync(path.join(SHARED_SRC, file), "utf8");
    fs.writeFileSync(path.join(SHARED_DEST, file), rewrite(raw, "shared"));
    console.log("ported shared", file);
}

for (const stub of keep) {
    if (!fs.existsSync(path.join(DEST, stub))) {
        console.warn("missing stub", stub);
    }
}

console.log("done");
