/**
 * Script to add 'Customer' to ImportType enum if it doesn't exist
 *
 * Usage: npx tsx scripts/database/add-customer-to-import-type-enum.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function addCustomerToImportTypeEnum() {
    console.log("Adding 'Customer' to ImportType enum...\n");

    try {
        // Check if 'Customer' already exists
        const existingValues = (await prisma.$queryRawUnsafe(`
            SELECT unnest(enum_range(NULL::"ImportType"))::text AS enum_value;
        `)) as Array<{ enum_value: string }>;

        const hasCustomer = existingValues.some(
            (row) => row.enum_value === "Customer"
        );

        if (hasCustomer) {
            console.log("✅ 'Customer' already exists in ImportType enum");
            console.log("\nCurrent enum values:");
            existingValues.forEach((row, index) => {
                console.log(`  ${index + 1}. ${row.enum_value}`);
            });
            return;
        }

        console.log("Current enum values:");
        existingValues.forEach((row, index) => {
            console.log(`  ${index + 1}. ${row.enum_value}`);
        });

        console.log("\n⚠️  'Customer' is missing. Adding it now...");

        // Add 'Customer' to the enum
        await prisma.$executeRawUnsafe(`
            ALTER TYPE "ImportType" ADD VALUE 'Customer';
        `);

        console.log("✅ Successfully added 'Customer' to ImportType enum");

        // Wait a moment for enum to be available
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Verify it was added
        const updatedValues = (await prisma.$queryRawUnsafe(`
            SELECT unnest(enum_range(NULL::"ImportType"))::text AS enum_value 
            ORDER BY enum_value;
        `)) as Array<{ enum_value: string }>;

        console.log("\nUpdated enum values:");
        updatedValues.forEach((row, index) => {
            console.log(`  ${index + 1}. ${row.enum_value}`);
        });
    } catch (error: any) {
        console.error("❌ Error adding 'Customer' to enum:", error.message);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

addCustomerToImportTypeEnum()
    .then(() => {
        console.log("\n✓ Script completed successfully");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n✗ Script failed:", error);
        process.exit(1);
    });
