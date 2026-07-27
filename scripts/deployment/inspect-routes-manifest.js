const fs = require("fs");
const path = process.argv[2];
if (!path || !fs.existsSync(path)) {
    console.error("Usage: node inspect-routes-manifest.js <path>");
    process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
console.log("path:", path);
console.log("size:", fs.statSync(path).size);
console.log("keys:", Object.keys(manifest));
for (const key of Object.keys(manifest)) {
    const value = manifest[key];
    const type = Array.isArray(value) ? `array(${value.length})` : typeof value;
    console.log(`  ${key}: ${type}`);
}
