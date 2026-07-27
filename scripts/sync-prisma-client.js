/**
 * Prisma schema lives at backend/prisma/. Generate may write into root or
 * backend node_modules depending on cwd; sync into frontend + backend installs.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

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
    const candidates = [
        path.join(root, "node_modules", ".prisma"),
        path.join(root, "backend", "node_modules", ".prisma"),
        path.join(root, "frontend", "node_modules", ".prisma"),
    ];
    for (const candidate of candidates) {
        const indexJs = path.join(candidate, "client", "index.js");
        if (fs.existsSync(indexJs) && fs.statSync(indexJs).size > 10_000) {
            return candidate;
        }
    }
    return null;
}

function findGeneratedClientPkg(nearPrisma) {
    const tryPaths = [
        path.join(path.dirname(nearPrisma), "@prisma", "client"),
        path.join(root, "node_modules", "@prisma", "client"),
        path.join(root, "backend", "node_modules", "@prisma", "client"),
    ];
    for (const p of tryPaths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function syncInto(targetRoot, srcPrisma, srcClientPkg) {
    const destPrisma = path.join(targetRoot, "node_modules", ".prisma");
    const destClient = path.join(targetRoot, "node_modules", "@prisma", "client");
    if (!fs.existsSync(path.join(targetRoot, "node_modules"))) {
        console.warn(`[sync-prisma] skip ${targetRoot} (no node_modules)`);
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
    console.log(`[sync-prisma] synced into ${path.relative(root, targetRoot)}`);
}

const srcPrisma = findGeneratedPrisma();
if (!srcPrisma) {
    throw new Error(
        "[sync-prisma] no generated client found; run prisma generate --schema=backend/prisma/schema.prisma first"
    );
}
const srcClientPkg = findGeneratedClientPkg(srcPrisma);
syncInto(path.join(root, "frontend"), srcPrisma, srcClientPkg);
syncInto(path.join(root, "backend"), srcPrisma, srcClientPkg);
