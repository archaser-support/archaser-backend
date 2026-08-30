#!/usr/bin/env node
/**
 * Asserts this package is a leaf: no source file may import another @archaser
 * workspace package, and no file may reach outside `src/` with a relative path.
 * Either would let a dependency cycle form, since api, reports, cron-jobs and
 * billing-connector all depend on this package.
 *
 * Run: npm run check:leaf -w @archaser/credit-insurance-domain
 */
const fs = require("fs");
const path = require("path");

// Defaults to this package's src/. An explicit path is accepted so the check can
// be pointed at another tree to confirm it does detect violations.
const SRC = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, "..", "src");
const SPECIFIER =
    /(?:from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

const files = [];
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith(".ts")) files.push(full);
    }
})(SRC);

const violations = [];

for (const file of files) {
    const rel = path.relative(SRC, file);
    SPECIFIER.lastIndex = 0;
    let match;
    while ((match = SPECIFIER.exec(fs.readFileSync(file, "utf8")))) {
        const spec = match[1];
        if (spec.startsWith("@archaser/")) {
            violations.push(`${rel} imports workspace package ${spec}`);
            continue;
        }
        if (!spec.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), spec);
        if (!resolved.startsWith(SRC + path.sep)) {
            violations.push(`${rel} reaches outside src/ via ${spec}`);
        }
    }
}

if (violations.length > 0) {
    console.error(
        `check:leaf FAILED — ${violations.length} violation(s) across ${files.length} files:`
    );
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
}

console.log(`check:leaf OK — ${files.length} files, no @archaser imports, nothing outside src/`);
