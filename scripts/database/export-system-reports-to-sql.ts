/**
 * Script to export all system reports from local database and generate SQL for staging
 *
 * Usage:
 *   ts-node scripts/database/export-system-reports-to-sql.ts [--output=<file.sql>]
 *
 * This script:
 * - Queries all reports where is_system = true from local database
 * - Generates SQL INSERT statements for staging database
 * - Handles JSON fields, timestamps, and NULL values properly
 */

import { prisma } from "../../frontend/lib/prisma";

/**
 * Escape a string for SQL
 */
function escapeSqlString(str: string | null | undefined): string {
    if (str === null || str === undefined) {
        return "NULL";
    }
    // Replace single quotes with two single quotes (SQL escaping)
    const escaped = str.replace(/'/g, "''");
    return `'${escaped}'`;
}

/**
 * Format a JSON value for SQL
 */
function formatJsonForSql(json: any): string {
    if (json === null || json === undefined) {
        return "NULL";
    }
    // Convert to JSON string and escape single quotes
    const jsonString = JSON.stringify(json);
    const escaped = jsonString.replace(/'/g, "''");
    return `'${escaped}'::jsonb`;
}

/**
 * Format a date for SQL
 */
function formatDateForSql(date: Date | null | undefined): string {
    if (date === null || date === undefined) {
        return "NULL";
    }
    // Format as ISO 8601 with timezone
    return `'${date.toISOString()}'::timestamptz`;
}

/**
 * Format a boolean for SQL
 */
function formatBooleanForSql(value: boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return "NULL";
    }
    return value ? "true" : "false";
}

/**
 * Generate SQL INSERT statement for a report
 */
function generateInsertStatement(report: any): string {
    const values = [
        // id - let database auto-generate, so we don't include it
        // account_id - keep original account_id (system reports should have account_id = 10013)
        report.account_id,
        escapeSqlString(report.name),
        escapeSqlString(report.description),
        formatJsonForSql(report.report_config),
        formatBooleanForSql(report.is_public),
        formatBooleanForSql(report.is_system),
        formatBooleanForSql(report.is_default),
        escapeSqlString(report.context),
        formatDateForSql(report.created_at),
        formatDateForSql(report.modified_at),
        escapeSqlString(report.created_by),
        escapeSqlString(report.modified_by),
    ];

    return `INSERT INTO "Report" (
    account_id,
    name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
) VALUES (
    ${values.join(",\n    ")}
);`;
}

async function exportSystemReports(outputFile?: string): Promise<void> {
    console.log("Querying system reports from local database...");

    // Query all system reports
    const reports = await prisma.report.findMany({
        where: {
            is_system: true,
        },
        orderBy: {
            id: "asc",
        },
    });

    console.log(`Found ${reports.length} system report(s)`);

    if (reports.length === 0) {
        console.log("No system reports found. Exiting.");
        return;
    }

    // Generate SQL statements
    const sqlStatements: string[] = [];

    sqlStatements.push("-- ============================================================================");
    sqlStatements.push("-- System Reports Migration Script");
    sqlStatements.push(`-- Generated: ${new Date().toISOString()}`);
    sqlStatements.push(`-- Total Reports: ${reports.length}`);
    sqlStatements.push("-- ============================================================================");
    sqlStatements.push("");
    sqlStatements.push("BEGIN;");
    sqlStatements.push("");
    sqlStatements.push("-- Delete existing system reports (optional - uncomment if needed)");
    sqlStatements.push("-- DELETE FROM \"Report\" WHERE is_system = true;");
    sqlStatements.push("");
    sqlStatements.push("-- Insert system reports");
    sqlStatements.push("");

    for (const report of reports) {
        sqlStatements.push(`-- Report ID: ${report.id}, Name: ${report.name}`);
        if (report.context) {
            sqlStatements.push(`-- Context: ${report.context}`);
        }
        sqlStatements.push(generateInsertStatement(report));
        sqlStatements.push("");
    }

    sqlStatements.push("COMMIT;");
    sqlStatements.push("");
    sqlStatements.push("-- ============================================================================");
    sqlStatements.push("-- End of System Reports Migration Script");
    sqlStatements.push("-- ============================================================================");

    const sql = sqlStatements.join("\n");

    // Output to file or console
    if (outputFile) {
        const fs = require("fs");
        fs.writeFileSync(outputFile, sql, "utf8");
        console.log(`✓ SQL script written to: ${outputFile}`);
    } else {
        console.log("\n" + "=".repeat(80));
        console.log("SQL INSERT Statements:");
        console.log("=".repeat(80) + "\n");
        console.log(sql);
    }

    console.log(`\n✓ Generated SQL for ${reports.length} system report(s)`);
    console.log("\nDone!");
}

// Parse command line arguments
const args = process.argv.slice(2);
let outputFile: string | undefined;

for (const arg of args) {
    if (arg.startsWith("--output=")) {
        outputFile = arg.split("=")[1];
    } else if (arg === "--help" || arg === "-h") {
        console.log("Usage: ts-node export-system-reports-to-sql.ts [--output=<file.sql>]");
        console.log("");
        console.log("Options:");
        console.log("  --output=<file.sql>  Write SQL to file instead of console");
        console.log("  --help, -h          Show this help message");
        process.exit(0);
    }
}

// Run the script
exportSystemReports(outputFile)
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error("Error:", error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });









