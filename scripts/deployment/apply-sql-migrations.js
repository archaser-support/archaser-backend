/**
 * Deploy SQL apply step.
 *
 * Enabling release: when this database has no applied list, record every
 * migrations-folder SQL file that is on the committed baseline and execute none
 * of them. A SQL file that is not on that list fails the step with no rows written.
 *
 * After that list exists, only unrecorded files run, in filename order, each in
 * one transaction. A bad name, a forbidden statement, or a checksum change
 * fails the step before any new file runs. Scripts outside prisma/migrations
 * are never read.
 *
 * Uses DATABASE_URL from the environment (the deploy script loads one
 * environment's env file before calling this). Does not select another database.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dotenv = require("dotenv");
const { PrismaClient } = require("@prisma/client");

const APPLIED_TABLE = "deploy_sql_applied";
const DATED_FILENAME = /^[0-9]{8}_.+\.sql$/;
const LOCK_TIMEOUT = "30s";
// Prisma cancels an interactive transaction at this client timeout. It is not a
// Postgres statement_timeout: a statement that holds its lock keeps running.
const TRANSACTION_TIMEOUT_MS = 2147483647;

const FORBIDDEN_SQL = [
    { pattern: /\bBEGIN\b/i, label: "BEGIN" },
    { pattern: /\bCOMMIT\b/i, label: "COMMIT" },
    { pattern: /\bCREATE\s+INDEX\s+CONCURRENTLY\b/i, label: "CREATE INDEX CONCURRENTLY" },
    { pattern: /\bVACUUM\b/i, label: "VACUUM" },
];

function repoRoot() {
    return path.resolve(__dirname, "../..");
}

function migrationsDir(root = repoRoot()) {
    return path.join(root, "prisma", "migrations");
}

function baselinePath(root = repoRoot()) {
    return path.join(migrationsDir(root), "baseline.json");
}

function fileChecksum(contents) {
    const normalized = contents.replace(/\r\n/g, "\n");
    return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function listMigrationFiles(dir) {
    const names = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
        .map((entry) => entry.name)
        .sort();

    return names.map((filename) => {
        const contents = fs.readFileSync(path.join(dir, filename), "utf8");
        return { filename, checksum: fileChecksum(contents) };
    });
}

function readBaseline(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || !Array.isArray(parsed.files)) {
        throw new Error(`Baseline list at ${filePath} is missing a files array`);
    }
    const files = parsed.files.map((entry) => {
        if (!entry || typeof entry.filename !== "string" || typeof entry.checksum !== "string") {
            throw new Error(`Baseline list at ${filePath} has an entry without filename and checksum`);
        }
        return { filename: entry.filename, checksum: entry.checksum };
    });
    files.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
    return files;
}

function baselineMismatch(onDisk, baseline) {
    const diskByName = new Map(onDisk.map((file) => [file.filename, file.checksum]));
    const baselineByName = new Map(baseline.map((file) => [file.filename, file.checksum]));
    const problems = [];

    for (const file of onDisk) {
        if (!baselineByName.has(file.filename)) {
            problems.push(`${file.filename} is not on the baseline list`);
        } else if (baselineByName.get(file.filename) !== file.checksum) {
            problems.push(`${file.filename} checksum does not match the baseline list`);
        }
    }
    for (const file of baseline) {
        if (!diskByName.has(file.filename)) {
            problems.push(`${file.filename} is on the baseline list but missing from prisma/migrations`);
        }
    }
    return problems;
}

function stripSqlComments(sql) {
    let out = "";
    let i = 0;
    while (i < sql.length) {
        if (sql[i] === "-" && sql[i + 1] === "-") {
            const end = sql.indexOf("\n", i);
            i = end === -1 ? sql.length : end;
            continue;
        }
        if (sql[i] === "/" && sql[i + 1] === "*") {
            const end = sql.indexOf("*/", i + 2);
            i = end === -1 ? sql.length : end + 2;
            out += " ";
            continue;
        }
        if (sql[i] === "'") {
            i += 1;
            while (i < sql.length) {
                if (sql[i] === "'" && sql[i + 1] === "'") {
                    i += 2;
                    continue;
                }
                if (sql[i] === "'") {
                    i += 1;
                    break;
                }
                i += 1;
            }
            out += " ";
            continue;
        }
        const tag = readDollarTag(sql, i);
        if (tag) {
            const closeAt = sql.indexOf(tag, i + tag.length);
            i = closeAt === -1 ? sql.length : closeAt + tag.length;
            out += " ";
            continue;
        }
        out += sql[i];
        i += 1;
    }
    return out;
}

function forbiddenSql(contents) {
    const sql = stripSqlComments(contents);
    const hits = [];
    for (const rule of FORBIDDEN_SQL) {
        if (rule.pattern.test(sql)) {
            hits.push(rule.label);
        }
    }
    return hits;
}

function readDollarTag(sql, start) {
    if (sql[start] !== "$") return null;
    const end = sql.indexOf("$", start + 1);
    if (end === -1) return null;
    const tag = sql.slice(start, end + 1);
    if (!/^\$[A-Za-z0-9_]*\$$/.test(tag)) return null;
    return tag;
}

function splitSql(sql) {
    const statements = [];
    let current = "";
    let i = 0;

    while (i < sql.length) {
        if (sql[i] === "-" && sql[i + 1] === "-") {
            const end = sql.indexOf("\n", i);
            const next = end === -1 ? sql.length : end;
            current += sql.slice(i, next);
            i = next;
            continue;
        }
        if (sql[i] === "/" && sql[i + 1] === "*") {
            const end = sql.indexOf("*/", i + 2);
            const next = end === -1 ? sql.length : end + 2;
            current += sql.slice(i, next);
            i = next;
            continue;
        }
        if (sql[i] === "'") {
            current += sql[i];
            i += 1;
            while (i < sql.length) {
                current += sql[i];
                if (sql[i] === "'" && sql[i + 1] === "'") {
                    current += sql[i + 1];
                    i += 2;
                    continue;
                }
                if (sql[i] === "'") {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        const tag = readDollarTag(sql, i);
        if (tag) {
            const closeAt = sql.indexOf(tag, i + tag.length);
            const next = closeAt === -1 ? sql.length : closeAt + tag.length;
            current += sql.slice(i, next);
            i = next;
            continue;
        }
        if (sql[i] === ";") {
            const statement = current.trim();
            if (statement) statements.push(statement);
            current = "";
            i += 1;
            continue;
        }
        current += sql[i];
        i += 1;
    }

    const tail = current.trim();
    if (tail) statements.push(tail);
    return statements;
}

function pendingFileProblems(pending, dir) {
    const problems = [];
    for (const file of pending) {
        if (!DATED_FILENAME.test(file.filename)) {
            problems.push(`${file.filename} must be named YYYYMMDD_description.sql`);
        }
    }
    if (problems.length > 0) return problems;

    for (const file of pending) {
        const contents = fs.readFileSync(path.join(dir, file.filename), "utf8");
        const hits = forbiddenSql(contents);
        for (const hit of hits) {
            problems.push(`${file.filename} contains ${hit}`);
        }
    }
    return problems;
}

async function applyOneFile(prisma, dir, file) {
    const contents = fs.readFileSync(path.join(dir, file.filename), "utf8");
    const statements = splitSql(contents);
    const appliedAt = new Date();

    await prisma.$transaction(
        async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
            for (const statement of statements) {
                await tx.$executeRawUnsafe(statement);
            }
            await tx.$executeRawUnsafe(
                `INSERT INTO ${APPLIED_TABLE} (filename, checksum, applied_at) VALUES ($1, $2, $3)`,
                file.filename,
                file.checksum,
                appliedAt
            );
        },
        { timeout: TRANSACTION_TIMEOUT_MS }
    );
}

function isMissingAppliedTable(error) {
    if (!error) return false;
    if (error.code === "42P01") return true;
    const metaCode = error.meta && error.meta.code;
    return metaCode === "42P01";
}

async function readApplied(prisma) {
    try {
        const rows = await prisma.$queryRawUnsafe(
            `SELECT filename, checksum FROM ${APPLIED_TABLE} ORDER BY filename`
        );
        return rows.map((row) => ({
            filename: String(row.filename),
            checksum: String(row.checksum),
        }));
    } catch (error) {
        if (isMissingAppliedTable(error)) {
            return [];
        }
        throw error;
    }
}

async function recordBaseline(prisma, files) {
    const appliedAt = new Date();
    await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS ${APPLIED_TABLE} (
                filename TEXT PRIMARY KEY,
                checksum TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL
            )
        `);
        for (const file of files) {
            await tx.$executeRawUnsafe(
                `INSERT INTO ${APPLIED_TABLE} (filename, checksum, applied_at) VALUES ($1, $2, $3)`,
                file.filename,
                file.checksum,
                appliedAt
            );
        }
    });
}

/**
 * @param {{ prisma?: import("@prisma/client").PrismaClient, root?: string }} [options]
 * @returns {Promise<{ mode: "baseline" | "already-applied" | "applied", recorded: number }>}
 */
async function applySqlMigrations(options = {}) {
    const root = options.root || repoRoot();
    const dir = migrationsDir(root);
    const ownsClient = !options.prisma;
    const prisma = options.prisma || new PrismaClient({ log: ["error"] });

    try {
        dotenv.config({ path: path.join(root, ".env"), override: true });
        if (!process.env.DATABASE_URL) {
            throw new Error("DATABASE_URL is not set. Load this environment's env file before the apply step.");
        }

        const onDisk = listMigrationFiles(dir);
        const baseline = readBaseline(baselinePath(root));
        const applied = await readApplied(prisma);

        if (applied.length === 0) {
            const problems = baselineMismatch(onDisk, baseline);
            if (problems.length > 0) {
                throw new Error(
                    `Refusing to baseline this database. The release is not the baseline release:\n${problems.join("\n")}`
                );
            }
            await recordBaseline(prisma, onDisk);
            return { mode: "baseline", recorded: onDisk.length };
        }

        const appliedByName = new Map(applied.map((row) => [row.filename, row.checksum]));
        const diskByName = new Map(onDisk.map((file) => [file.filename, file.checksum]));
        const problems = [];

        for (const row of applied) {
            const checksum = diskByName.get(row.filename);
            if (!checksum) {
                problems.push(`${row.filename} is recorded but missing from prisma/migrations`);
            } else if (checksum !== row.checksum) {
                problems.push(`${row.filename} checksum changed after it was recorded`);
            }
        }
        if (problems.length > 0) {
            throw new Error(`Refusing to continue the deploy:\n${problems.join("\n")}`);
        }

        const pending = onDisk.filter((file) => !appliedByName.has(file.filename));
        if (pending.length === 0) {
            return { mode: "already-applied", recorded: 0 };
        }

        const pendingProblems = pendingFileProblems(pending, dir);
        if (pendingProblems.length > 0) {
            throw new Error(
                `Refusing to run new migration files:\n${pendingProblems.join("\n")}`
            );
        }

        for (const file of pending) {
            try {
                await applyOneFile(prisma, dir, file);
            } catch (error) {
                const message = error && error.message ? error.message : String(error);
                throw new Error(
                    `${file.filename} failed and was not recorded. Later files were not run.\n${message}`
                );
            }
        }

        return { mode: "applied", recorded: pending.length };
    } finally {
        if (ownsClient) {
            await prisma.$disconnect();
        }
    }
}

async function main() {
    const result = await applySqlMigrations();
    if (result.mode === "baseline") {
        process.stdout.write(
            `Recorded ${result.recorded} migration files. No migration SQL was executed.\n`
        );
        return;
    }
    if (result.mode === "applied") {
        process.stdout.write(`Applied ${result.recorded} migration file(s).\n`);
        return;
    }
    process.stdout.write("Applied list already matches the migration files. No migration SQL was executed.\n");
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error && error.message ? error.message : error}\n`);
        process.exit(1);
    });
}

module.exports = {
    APPLIED_TABLE,
    applySqlMigrations,
    fileChecksum,
    listMigrationFiles,
    readBaseline,
    baselineMismatch,
    forbiddenSql,
    splitSql,
    DATED_FILENAME,
};
