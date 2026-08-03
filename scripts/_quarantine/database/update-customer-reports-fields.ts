/**
 * Script to update "All Customers" and "Inactive Customers" reports
 * to match the fields from "Active Customers" report
 */

import { PrismaClient } from "@prisma/client";
import { ReportService } from "../../frontend/server/services/ReportService";

const prisma = new PrismaClient();
const SYSTEM_ADMIN_ACCOUNT_ID = 10013;

async function updateCustomerReportsFields() {
    try {
        console.log("Starting update of customer filter reports fields...");

        const reportService = ReportService.getInstance();

        // Get the "Active Customers" report to use as the source
        const activeCustomersReport = await prisma.report.findFirst({
            where: {
                account_id: SYSTEM_ADMIN_ACCOUNT_ID,
                is_system: true,
                context: "customers",
                name: "Active Customers",
            },
        });

        if (!activeCustomersReport) {
            throw new Error("Active Customers report not found");
        }

        const activeConfig = activeCustomersReport.report_config as any;
        if (!activeConfig || !activeConfig.fields) {
            throw new Error("Active Customers report has no fields configured");
        }

        console.log(
            `📋 Found "Active Customers" report with ${activeConfig.fields.length} fields`
        );

        // Get the reports to update
        const reportsToUpdate = await prisma.report.findMany({
            where: {
                account_id: SYSTEM_ADMIN_ACCOUNT_ID,
                is_system: true,
                context: "customers",
                name: {
                    in: ["All Customers", "Inactive Customers"],
                },
            },
        });

        if (reportsToUpdate.length === 0) {
            console.log("⚠️  No reports found to update");
            return;
        }

        console.log(`\n📝 Updating ${reportsToUpdate.length} reports...`);

        // Get system admin user ID for updating reports
        const adminUser = await prisma.user.findFirst({
            where: {
                account_id: SYSTEM_ADMIN_ACCOUNT_ID,
                role: "archaser_admin",
                status: "Active",
            },
            select: { id: true },
        });

        if (!adminUser) {
            throw new Error(
                `No active admin user found for account ${SYSTEM_ADMIN_ACCOUNT_ID}`
            );
        }

        let updatedCount = 0;

        for (const report of reportsToUpdate) {
            const existingConfig = report.report_config as any;

            // Update the fields while preserving filters and other config
            const updatedConfig = {
                ...existingConfig,
                fields: activeConfig.fields,
                // Preserve filters (they differ between reports)
                filters: existingConfig.filters || [],
            };

            await reportService.updateReport(
                report.id,
                {
                    report_config: updatedConfig,
                    modified_by: adminUser.id,
                },
                SYSTEM_ADMIN_ACCOUNT_ID
            );

            console.log(
                `✅ Updated "${report.name}" (ID: ${report.id}) with ${activeConfig.fields.length} fields`
            );
            updatedCount++;
        }

        console.log("\n📊 Summary:");
        console.log(`   Updated: ${updatedCount} reports`);
        console.log(`   Fields copied: ${activeConfig.fields.length}`);
        console.log("\n✨ Done!");
    } catch (error) {
        console.error("❌ Error updating reports:", error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run the script
if (require.main === module) {
    updateCustomerReportsFields()
        .then(() => {
            process.exit(0);
        })
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

export { updateCustomerReportsFields };









