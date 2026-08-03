/**
 * Script to mark existing reports as system reports
 *
 * Usage:
 *   ts-node scripts/database/mark-system-reports.ts <reportId1> [reportId2] ... [--context=<context>]
 *
 * Example:
 *   ts-node scripts/database/mark-system-reports.ts 1 2 3 --context=customers
 *
 * This script:
 * - Validates that reports belong to account 10013 (archaser_admin)
 * - Marks reports as system reports (is_system = true)
 * - Optionally sets the context field
 * - Copies the reports to all existing accounts
 */

import { prisma } from "../../frontend/lib/prisma";
import { ReportService } from "../../frontend/server/services/ReportService";

const ARCHASER_ADMIN_ACCOUNT_ID = 10013;

async function markSystemReports(
    reportIds: number[],
    context?: string
): Promise<void> {
    console.log(`Marking ${reportIds.length} report(s) as system reports...`);

    // Validate all reports exist and belong to account 10013
    const reports = await prisma.report.findMany({
        where: {
            id: { in: reportIds },
        },
    });

    if (reports.length !== reportIds.length) {
        const foundIds = reports.map((r) => r.id);
        const missingIds = reportIds.filter((id) => !foundIds.includes(id));
        throw new Error(`Reports not found: ${missingIds.join(", ")}`);
    }

    // Check all reports belong to account 10013
    const invalidReports = reports.filter(
        (r) => r.account_id !== ARCHASER_ADMIN_ACCOUNT_ID
    );
    if (invalidReports.length > 0) {
        throw new Error(
            `The following reports do not belong to account ${ARCHASER_ADMIN_ACCOUNT_ID}: ${invalidReports.map((r) => r.id).join(", ")}`
        );
    }

    // Update reports to mark as system
    const modified_ata: any = {
        is_system: true,
    };
    if (context) {
        modified_ata.context = context;
    }

    await prisma.report.updateMany({
        where: {
            id: { in: reportIds },
            account_id: ARCHASER_ADMIN_ACCOUNT_ID,
        },
        data: modified_ata,
    });

    console.log(
        `✓ Successfully marked ${reportIds.length} report(s) as system reports`
    );
    if (context) {
        console.log(`  Context set to: ${context}`);
    }

    // Get all existing accounts (excluding account 10013)
    const accounts = await prisma.account.findMany({
        where: {
            id: { not: ARCHASER_ADMIN_ACCOUNT_ID },
            deleted_at: null,
        },
        select: { id: true },
    });

    console.log(
        `\nCopying system reports to ${accounts.length} existing account(s)...`
    );

    const reportService = ReportService.getInstance();
    let copiedCount = 0;

    for (const account of accounts) {
        try {
            // Copy each system report to the account
            for (const report of reports) {
                await (prisma.report as any).create({
                    data: {
                        account_id: account.id,
                        name: report.name,
                        description: report.description,
                        report_config: report.report_config as any,
                        is_public: report.is_public,
                        is_system: true,
                        context: context || (report as any).context,
                        created_by: report.created_by,
                        modified_by: report.modified_by,
                    },
                });
            }
            copiedCount++;
        } catch (error) {
            console.error(
                `  ✗ Failed to copy to account ${account.id}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    console.log(
        `✓ Successfully copied system reports to ${copiedCount} account(s)`
    );
    console.log("\nDone!");
}

// Parse command line arguments
const args = process.argv.slice(2);
const reportIds: number[] = [];
let context: string | undefined;

for (const arg of args) {
    if (arg.startsWith("--context=")) {
        context = arg.split("=")[1];
    } else {
        const id = parseInt(arg, 10);
        if (isNaN(id)) {
            console.error(`Invalid report ID: ${arg}`);
            process.exit(1);
        }
        reportIds.push(id);
    }
}

if (reportIds.length === 0) {
    console.error(
        "Usage: ts-node mark-system-reports.ts <reportId1> [reportId2] ... [--context=<context>]"
    );
    console.error(
        "Example: ts-node mark-system-reports.ts 1 2 3 --context=customers"
    );
    process.exit(1);
}

// Run the script
markSystemReports(reportIds, context)
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error("Error:", error.message);
        process.exit(1);
    });
