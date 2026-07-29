/**
 * Prisma schema lives at backend/prisma/. Generate may write into this package,
 * the monorepo root, or a sibling install depending on cwd; sync into every
 * install that exists in the current layout. Supports both the monorepo
 * checkout (frontend/ + backend/ siblings) and a standalone backend repo.
 */
const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(packageRoot, "..");

function uniquePaths(paths) {
    const seen = new Set();
    return paths.filter((entry) => {
        const resolved = path.resolve(entry);
        if (seen.has(resolved)) return false;
        seen.add(resolved);
        return true;
    });
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(from, to);
        else fs.copyFileSync(from, to);
    }
}

function findGeneratedPrisma() {
    const candidates = uniquePaths([
        path.join(packageRoot, "node_modules", ".prisma"),
        path.join(workspaceRoot, "node_modules", ".prisma"),
        path.join(workspaceRoot, "backend", "node_modules", ".prisma"),
        path.join(workspaceRoot, "frontend", "node_modules", ".prisma"),
    ]);
    for (const candidate of candidates) {
        const indexJs = path.join(candidate, "client", "index.js");
        if (fs.existsSync(indexJs) && fs.statSync(indexJs).size > 10_000) {
            return candidate;
        }
    }
    return null;
}

function findGeneratedClientPkg(nearPrisma) {
    const tryPaths = uniquePaths([
        path.join(path.dirname(nearPrisma), "@prisma", "client"),
        path.join(packageRoot, "node_modules", "@prisma", "client"),
        path.join(workspaceRoot, "node_modules", "@prisma", "client"),
        path.join(workspaceRoot, "backend", "node_modules", "@prisma", "client"),
    ]);
    for (const p of tryPaths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function syncInto(targetRoot, srcPrisma, srcClientPkg) {
    const destPrisma = path.join(targetRoot, "node_modules", ".prisma");
    const destClient = path.join(targetRoot, "node_modules", "@prisma", "client");
    if (!fs.existsSync(targetRoot)) {
        return;
    }
    if (!fs.existsSync(path.join(targetRoot, "node_modules"))) {
        console.warn(`[sync-prisma] skip ${targetRoot} (no node_modules)`);
        return;
    }
    // Generate already wrote here — copying onto the source would delete it.
    if (path.resolve(destPrisma) === path.resolve(srcPrisma)) {
        console.log(
            `[sync-prisma] ${path.relative(workspaceRoot, targetRoot)} already holds the generated client`
        );
        return;
    }
    fs.rmSync(destPrisma, { recursive: true, force: true });
    copyDir(srcPrisma, destPrisma);
    if (srcClientPkg && fs.existsSync(destClient)) {
        for (const file of fs.readdirSync(srcClientPkg)) {
            if (file === "node_modules" || file === "package.json") continue;
            const from = path.join(srcClientPkg, file);
            const to = path.join(destClient, file);
            const st = fs.statSync(from);
            if (st.isDirectory()) {
                fs.rmSync(to, { recursive: true, force: true });
                copyDir(from, to);
            } else {
                fs.copyFileSync(from, to);
            }
        }
    }
    console.log(
        `[sync-prisma] synced into ${path.relative(workspaceRoot, targetRoot)}`
    );
}

const srcPrisma = findGeneratedPrisma();
if (!srcPrisma) {
    throw new Error(
        "[sync-prisma] no generated client found; run prisma generate --schema=prisma/schema.prisma first"
    );
}
const srcClientPkg = findGeneratedClientPkg(srcPrisma);
for (const target of uniquePaths([
    packageRoot,
    path.join(workspaceRoot, "frontend"),
    path.join(workspaceRoot, "backend"),
])) {
    syncInto(target, srcPrisma, srcClientPkg);
}
