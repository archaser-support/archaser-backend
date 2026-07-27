const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET_DIRS = ["app", "pages", "server"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const INLINE_USD_PATTERN = /\|\|\s*["']USD["']/;

const SKIP_PATHS = new Set([
    path.join("utils", "stringFormatters.ts"),
]);

function shouldSkipDir(dirName) {
    return dirName === "node_modules" || dirName === ".next" || dirName === ".git";
}

function walk(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        if (shouldSkipDir(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, files);
            continue;
        }

        const ext = path.extname(entry.name);
        if (EXTENSIONS.has(ext)) {
            files.push(fullPath);
        }
    }

    return files;
}

function findViolations(filePath) {
    const rel = path.relative(ROOT, filePath);
    if (SKIP_PATHS.has(rel)) return [];

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const violations = [];

    lines.forEach((line, idx) => {
        if (INLINE_USD_PATTERN.test(line)) {
            violations.push(`${rel}:${idx + 1}: ${line.trim()}`);
        }
    });

    return violations;
}

function main() {
    const files = TARGET_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
    const violations = files.flatMap(findViolations);

    if (violations.length > 0) {
        console.error(
            [
                "Inline USD fallback detected. Use resolveCustomerFirstCurrency instead.",
                "",
                ...violations,
            ].join("\n")
        );
        process.exit(1);
    }

    console.log("Currency fallback guard passed.");
}

main();
