/**
 * Script to create system reports for customer filters:
 * - All Customers
 * - Active Customers
 * - Inactive Customers
 *
 * These reports replace the status filter dropdown in CustomerList
 */

import { PrismaClient } from "@prisma/client";
import { ReportService } from "../../frontend/server/services/ReportService";

const prisma = new PrismaClient();
const SYSTEM_ADMIN_ACCOUNT_ID = 10013;

interface ReportDefinition {
    name: string;
    description: string;
    filter: {
        table: string;
        field: string;
        operator: string;
        value: any;
    } | null;
}

const reportDefinitions: ReportDefinition[] = [
    {
        name: "All Customers",
        description: "All customers regardless of status",
        filter: null,
    },
    {
        name: "Active Customers",
        description: "All active customers",
        filter: {
            table: "Customer",
            field: "collection_status",
            operator: "=",
            value: "Active",
        },
    },
    {
        name: "Inactive Customers",
        description: "All inactive customers",
        filter: {
            table: "Customer",
            field: "collection_status",
            operator: "=",
            value: "Inactive",
        },
    },
];

/**
 * Get a system admin user ID for creating reports
 */
async function getSystemAdminUserId(): Promise<string | undefined> {
    const adminUser = await prisma.user.findFirst({
        where: {
            account_id: SYSTEM_ADMIN_ACCOUNT_ID,
            role: "archaser_admin",
            status: "Active",
        },
        select: { id: true },
    });

    return adminUser?.id;
}

/**
 * Create customer filter reports
 */
async function createCustomerFilterReports() {
    try {
        console.log("Starting creation of customer filter reports...");

        const adminUserId = await getSystemAdminUserId();
        if (!adminUserId) {
            throw new Error(
                `No active admin user found for account ${SYSTEM_ADMIN_ACCOUNT_ID}`
            );
        }

        const reportService = ReportService.getInstance();

        // Check if reports already exist
        const existingReports = await prisma.report.findMany({
            where: {
                account_id: SYSTEM_ADMIN_ACCOUNT_ID,
                is_system: true,
                context: "customers",
                name: {
                    in: reportDefinitions.map((r) => r.name),
                },
            },
        });

        const existingNames = new Set(existingReports.map((r) => r.name));

        let createdCount = 0;
        let skippedCount = 0;

        for (const reportDef of reportDefinitions) {
            if (existingNames.has(reportDef.name)) {
                console.log(
                    `⏭️  Skipping "${reportDef.name}" - already exists`
                );
                skippedCount++;
                continue;
            }

            // Build report config with all required fields
            // The report execution service automatically constructs "name" from Person/Company relations
            // Person, Company, and ParentCustomer are relations, not separate tables, so we reference them via field paths
            // Note: CustomerCollectionPeriod is a one-to-many relation and may need special handling
            const reportConfig = {
                tables: ["Customer"],
                fields: [
                    // Basic customer fields (id is needed but report service may hide it)
                    { table: "Customer", field: "id" },
                    { table: "Customer", field: "customer_number" },
                    { table: "Customer", field: "collection_status" },
                    { table: "Customer", field: "type" },
                    { table: "Customer", field: "parent_customer_id" },

                    // Person fields (for name construction - report service auto-constructs "name")
                    // These are accessed via Person relation, not as a separate table
                    { table: "Customer", field: "Person.first_name" },
                    { table: "Customer", field: "Person.last_name" },
                    { table: "Customer", field: "Person.full_name" },

                    // Company fields (for name - report service auto-constructs "name")
                    // These are accessed via Company relation, not as a separate table
                    { table: "Customer", field: "Company.name" },

                    // Parent customer fields (for parent_customer display)
                    // ParentCustomer is a relation, accessed via field paths
                    {
                        table: "Customer",
                        field: "ParentCustomer.id",
                        alias: "parent_customer_id",
                    },
                    {
                        table: "Customer",
                        field: "ParentCustomer.customer_number",
                        alias: "parent_customer_number",
                    },
                    {
                        table: "Customer",
                        field: "ParentCustomer.type",
                        alias: "parent_customer_type",
                    },
                    {
                        table: "Customer",
                        field: "ParentCustomer.business_unit_id",
                        alias: "parent_customer_business_unit_id",
                    },
                    // Parent customer name fields via nested relations
                    {
                        table: "Customer",
                        field: "ParentCustomer.Person.first_name",
                        alias: "parent_person_first_name",
                    },
                    {
                        table: "Customer",
                        field: "ParentCustomer.Person.last_name",
                        alias: "parent_person_last_name",
                    },
                    {
                        table: "Customer",
                        field: "ParentCustomer.Person.full_name",
                        alias: "parent_person_full_name",
                    },
                    {
                        table: "Customer",
                        field: "ParentCustomer.Company.name",
                        alias: "parent_company_name",
                    },
                ],
                // No explicit joins needed - relations are handled automatically by the report execution service
                filters: reportDef.filter ? [reportDef.filter] : [],
                sorting: [
                    {
                        field: "name",
                        direction: "ASC" as const,
                    },
                ],
            };

            // Note: CustomerCollectionPeriod fields (current_category, no_of_overdue_invoices,
            // total_outstanding_amount) are accessed via CustomerCollectionPeriod[0] in the API.
            // The report execution service may need enhancement to support these one-to-many relations.
            // For now, these fields will need to be handled in the frontend transformation or
            // added via formulas if the report execution service supports them.

            const report = await reportService.createReport({
                account_id: SYSTEM_ADMIN_ACCOUNT_ID,
                name: reportDef.name,
                description: reportDef.description,
                report_config: reportConfig,
                is_public: true,
                is_system: true,
                context: "customers",
                created_by: adminUserId,
            });

            // Mark "All Customers" as default view
            if (reportDef.name === "All Customers") {
                await prisma.report.update({
                    where: { id: report.id },
                    data: { is_default: true },
                });
            }

            console.log(
                `✅ Created report: "${reportDef.name}" (ID: ${report.id})`
            );
            createdCount++;
        }

        console.log("\n📊 Summary:");
        console.log(`   Created: ${createdCount} reports`);
        console.log(`   Skipped: ${skippedCount} reports (already exist)`);
        console.log("\n✨ Done!");
    } catch (error) {
        console.error("❌ Error creating reports:", error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run the script
if (require.main === module) {
    createCustomerFilterReports()
        .then(() => {
            process.exit(0);
        })
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

export { createCustomerFilterReports };
