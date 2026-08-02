/**
 * Inventory FE api/apiFetch call sites vs Nest @Controller routes.
 * Usage: node scripts/inventory-fe-nest-routes.cjs
 * Exit 1 if any non-allowlisted FE path has no Nest controller match.
 */
const fs = require("fs");
const path = require("path");

const FE_ROOT = path.resolve(__dirname, "../../frontend");
const BE_SRC = path.resolve(__dirname, "../api/src");

function walk(dir, pred, files = []) {
    let ents;
    try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return files;
    }
    for (const ent of ents) {
        if (["node_modules", ".next", "coverage", "dist"].includes(ent.name)) {
            continue;
        }
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, pred, files);
        else if (pred(p, ent.name)) files.push(p);
    }
    return files;
}

function extractCalls(text) {
    const out = [];
    let m;
    const re = /\bapiFetch\s*\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g;
    while ((m = re.exec(text))) {
        out.push(m[1] || m[2] || m[3]);
    }
    const re2 =
        /\bapi\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/gi;
    while ((m = re2.exec(text))) {
        out.push(m[1] || m[2] || m[3]);
    }
    return out;
}

function normalize(raw) {
    let s = String(raw).split("?")[0].trim();
    if (!s.startsWith("/") && !s.startsWith("http")) return null;
    if (s.includes("${") && !s.includes("}")) return null;
    s = s.replace(/\$\{[^}]+\}/g, "{id}");
    s = s.replace(/\/\d+(?=\/|$)/g, "/{id}");
    s = s.replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "/{id}"
    );
    if (s.endsWith("/")) s = s.slice(0, -1);
    if (
        !s.startsWith("/api") &&
        !s.startsWith("/auth") &&
        !/^https?:/.test(s) &&
        s.startsWith("/")
    ) {
        s = "/api" + s;
    }
    return s;
}

function allowlisted(p) {
    return (
        p.startsWith("/api/auth") ||
        p.startsWith("/auth/") ||
        /^https?:\/\//.test(p)
    );
}

function looksLikeId(seg) {
    return (
        seg.startsWith("{") ||
        /^\d+$/.test(seg) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            seg
        )
    );
}

function isWildcardParam(seg) {
    if (!seg.startsWith("{")) return false;
    const name = seg.slice(1, -1).toLowerCase();
    if (name === "id" || name.endsWith("id") || name === "uuid") return false;
    // :operation, :leaf, :suffix, :entityType, etc.
    return true;
}

function pathMatches(fe, nest) {
    if (fe === nest) return true;
    const a = fe.split("/");
    const b = nest.split("/");
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue;
        if (isWildcardParam(a[i]) || isWildcardParam(b[i])) continue;
        if (a[i].startsWith("{") && looksLikeId(b[i])) continue;
        if (b[i].startsWith("{") && looksLikeId(a[i])) continue;
        return false;
    }
    return true;
}

function collectNestPaths() {
    const files = walk(BE_SRC, (_p, name) =>
        name.endsWith(".controller.ts") || name.endsWith(".controllers.ts")
    );
    const nestPaths = new Set();
    const ctrlRe = /@Controller\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
    const methodRe =
        /@(Get|Post|Put|Patch|Delete|All)\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/g;
    for (const f of files) {
        const text = fs.readFileSync(f, "utf8");
        const bases = [...text.matchAll(ctrlRe)].map((m) => m[1]);
        // Factory controllers: @Controller(`api/entities/${entityType}`)
        if (
            /@Controller\(\s*`api\/entities\/\$\{entityType\}`\s*\)/.test(text)
        ) {
            const types = [
                "accounts",
                "users",
                "business-units",
                "bank-accounts",
                "customer-banks",
                "insurance-policies",
                "insurance-policy-countries",
                "insurance-policy-named-policies",
            ];
            for (const t of types) bases.push(`api/entities/${t}`);
        }
        const methods = [...text.matchAll(methodRe)];
        for (const base of bases) {
            for (const m of methods) {
                const sub = m[2] ?? "";
                let full = ("/" + base + (sub ? "/" + sub : "")).replace(
                    /\/+/g,
                    "/"
                );
                full = full.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
                nestPaths.add(full);
            }
        }
    }

    // Explicit dynamic leaves that @All(":leaf") covers
    const ciLeaves = [
        "summary",
        "summary-history",
        "portfolio-health",
        "customer-dashboard-kpis",
        "customer-policy-trend",
        "report",
        "insurance-policy-trend",
        "mark-reported",
        "mark-reported-bulk",
    ];
    for (const leaf of ciLeaves) {
        nestPaths.add(`/api/credit-insurance/${leaf}`);
    }
    const portalSuffixes = [
        "portal-data",
        "agent-portal",
        "invoices",
        "bank-details",
        "banks",
        "disputes",
        "create-dispute",
        "view-disputes",
        "wrong-contact",
    ];
    for (const s of portalSuffixes) {
        nestPaths.add(`/api/customers/{id}/${s}`);
    }

    return nestPaths;
}

function main() {
    const nestPaths = collectNestPaths();
    const feFiles = ["app", "shared", "components", "lib", "utils"]
        .map((d) => path.join(FE_ROOT, d))
        .filter((d) => fs.existsSync(d))
        .flatMap((r) =>
            walk(
                r,
                (p, name) =>
                    /\.(ts|tsx|js|jsx)$/.test(name) &&
                    !/\.(test|spec)\./.test(name) &&
                    !p.includes(`${path.sep}test${path.sep}`)
            )
        );

    const byPath = new Map();
    for (const f of feFiles) {
        const text = fs.readFileSync(f, "utf8");
        for (const raw of extractCalls(text)) {
            const n = normalize(raw);
            if (!n || allowlisted(n) || n.includes("\n") || n.length > 120) {
                continue;
            }
            if (!byPath.has(n)) byPath.set(n, new Set());
            byPath.get(n).add(path.relative(FE_ROOT, f));
        }
    }

    const missing = [];
    for (const [fePath, files] of byPath) {
        let hit = false;
        for (const nest of nestPaths) {
            if (pathMatches(fePath, nest)) {
                hit = true;
                break;
            }
        }
        if (!hit) missing.push({ path: fePath, files: [...files] });
    }
    missing.sort((a, b) => a.path.localeCompare(b.path));

    console.log(
        JSON.stringify(
            {
                nestPaths: nestPaths.size,
                feUnique: byPath.size,
                missing: missing.length,
            },
            null,
            2
        )
    );
    for (const row of missing) {
        console.log(row.path + "\t" + row.files.slice(0, 2).join(", "));
    }
    process.exit(missing.length ? 1 : 0);
}

main();
