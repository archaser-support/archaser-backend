/**
 * Next.js 15+ builds may omit iterable route arrays from routes-manifest.json.
 * `next start` crashes when iterating missing fields, e.g.:
 *   TypeError: routesManifest.dataRoutes is not iterable
 *   TypeError: routesManifest.dynamicRoutes is not iterable
 */
const fs = require("fs");
const path = require("path");

const distDir = process.env.NEXT_DIST_DIR || path.join("frontend", "build");
const manifestPath = path.join(process.cwd(), distDir, "routes-manifest.json");
const requiredArrays = ["dataRoutes", "dynamicRoutes", "staticRoutes"];

if (!fs.existsSync(manifestPath)) {
    console.error(
        `[fix-routes-manifest] Missing ${manifestPath}. Run next build first.`
    );
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const patchedFields = [];

for (const field of requiredArrays) {
    if (!Array.isArray(manifest[field])) {
        manifest[field] = [];
        patchedFields.push(field);
    }
}

if (patchedFields.length === 0) {
    console.log(
        `[fix-routes-manifest] Required route arrays already present in ${manifestPath}`
    );
    process.exit(0);
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest));

console.log(
    `[fix-routes-manifest] Patched ${manifestPath}: added ${patchedFields.join(", ")}`
);
