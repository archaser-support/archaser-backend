/**
 * Migration script to add parent_customer_id field to Customer table
 * and create CustomerAggregatedData table
 *
 * This script should be run before generating Prisma migrations:
 * 1. Run this script to add the field and table
 * 2. Run: npx prisma db push (or create a migration)
 *
 * Usage:
 *   npx ts-node scripts/database/add-parent-customer-field.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log(
        "Starting migration: Add parent_customer_id field and CustomerAggregatedData table"
    );

    try {
        // Add parent_customer_id column to Customer table
        console.log("Adding parent_customer_id column to Customer table...");
        await prisma.$executeRaw`
            ALTER TABLE "Customer" 
            ADD COLUMN IF NOT EXISTS "parent_customer_id" INTEGER;
        `;

        // Add foreign key constraint (only if it doesn't exist)
        console.log("Adding foreign key constraint...");
        const constraintExists = await prisma.$queryRaw<
            Array<{ constraint_name: string }>
        >`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'Customer' 
            AND constraint_name = 'customer_parent_customer_id_fkey';
        `;

        if (constraintExists.length === 0) {
            await prisma.$executeRaw`
                ALTER TABLE "Customer"
                ADD CONSTRAINT "customer_parent_customer_id_fkey"
                FOREIGN KEY ("parent_customer_id")
                REFERENCES "Customer"("id")
                ON DELETE NO ACTION
                ON UPDATE NO ACTION;
            `;
            console.log("✓ Foreign key constraint added");
        } else {
            console.log("✓ Foreign key constraint already exists");
        }

        // Add index
        console.log("Adding index on parent_customer_id...");
        await prisma.$executeRaw`
            CREATE INDEX IF NOT EXISTS "idx_customer_parent_customer_id"
            ON "Customer"("parent_customer_id");
        `;

        // Create CustomerAggregatedData table
        console.log("Creating CustomerAggregatedData table...");
        await prisma.$executeRaw`
            CREATE TABLE IF NOT EXISTS "CustomerAggregatedData" (
                "id" SERIAL NOT NULL,
                "customer_id" INTEGER NOT NULL,
                "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "total_outstanding_amount" REAL,
                "customer_outstanding_amount1" DOUBLE PRECISION,
                "customer_outstanding_amount2" DOUBLE PRECISION,
                "customer_currency1" VARCHAR,
                "customer_currency2" VARCHAR,
                "no_of_overdue_invoices" SMALLINT,
                "no_of_due_invoices" SMALLINT,
                "total_invoices_count" SMALLINT,
                "total_paid_amount" REAL,
                "customer_total_paid_amount1" DOUBLE PRECISION,
                "customer_total_paid_amount2" DOUBLE PRECISION,
                "total_collection_periods" SMALLINT,
                "active_collection_periods" SMALLINT,
                "child_customers_count" SMALLINT,
                "created_by" VARCHAR,
                "modified_by" VARCHAR,
                CONSTRAINT "CustomerAggregatedData_pkey" PRIMARY KEY ("id"),
                CONSTRAINT "CustomerAggregatedData_customer_id_key" UNIQUE ("customer_id")
            );
        `;

        // Add foreign key constraint for CustomerAggregatedData (only if it doesn't exist)
        console.log(
            "Adding foreign key constraint for CustomerAggregatedData..."
        );
        const customerFkExists = await prisma.$queryRaw<
            Array<{ constraint_name: string }>
        >`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'CustomerAggregatedData' 
            AND constraint_name = 'CustomerAggregatedData_customer_id_fkey';
        `;

        if (customerFkExists.length === 0) {
            await prisma.$executeRaw`
                ALTER TABLE "CustomerAggregatedData"
                ADD CONSTRAINT "CustomerAggregatedData_customer_id_fkey"
                FOREIGN KEY ("customer_id")
                REFERENCES "Customer"("id")
                ON DELETE CASCADE
                ON UPDATE NO ACTION;
            `;
            console.log("✓ Foreign key constraint for customer_id added");
        } else {
            console.log(
                "✓ Foreign key constraint for customer_id already exists"
            );
        }

        // Add foreign key constraints for created_by and modified_by (only if they don't exist)
        console.log(
            "Adding foreign key constraints for created_by and modified_by..."
        );
        const createdByFkExists = await prisma.$queryRaw<
            Array<{ constraint_name: string }>
        >`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'CustomerAggregatedData' 
            AND constraint_name = 'CustomerAggregatedData_created_by_fkey';
        `;

        if (createdByFkExists.length === 0) {
            await prisma.$executeRaw`
                ALTER TABLE "CustomerAggregatedData"
                ADD CONSTRAINT "CustomerAggregatedData_created_by_fkey"
                FOREIGN KEY ("created_by")
                REFERENCES "User"("id")
                ON DELETE NO ACTION
                ON UPDATE NO ACTION;
            `;
            console.log("✓ Foreign key constraint for created_by added");
        } else {
            console.log(
                "✓ Foreign key constraint for created_by already exists"
            );
        }

        const modifiedByFkExists = await prisma.$queryRaw<
            Array<{ constraint_name: string }>
        >`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'CustomerAggregatedData' 
            AND constraint_name = 'CustomerAggregatedData_modified_by_fkey';
        `;

        if (modifiedByFkExists.length === 0) {
            await prisma.$executeRaw`
                ALTER TABLE "CustomerAggregatedData"
                ADD CONSTRAINT "CustomerAggregatedData_modified_by_fkey"
                FOREIGN KEY ("modified_by")
                REFERENCES "User"("id")
                ON DELETE NO ACTION
                ON UPDATE NO ACTION;
            `;
            console.log("✓ Foreign key constraint for modified_by added");
        } else {
            console.log(
                "✓ Foreign key constraint for modified_by already exists"
            );
        }

        // Add indexes
        console.log("Adding indexes...");
        await prisma.$executeRaw`
            CREATE INDEX IF NOT EXISTS "idx_customer_aggregated_data_customer_id"
            ON "CustomerAggregatedData"("customer_id");
        `;

        await prisma.$executeRaw`
            CREATE INDEX IF NOT EXISTS "idx_customer_aggregated_data_created_by"
            ON "CustomerAggregatedData"("created_by");
        `;

        await prisma.$executeRaw`
            CREATE INDEX IF NOT EXISTS "idx_customer_aggregated_data_modified_by"
            ON "CustomerAggregatedData"("modified_by");
        `;

        console.log("✓ Migration completed successfully");
    } catch (error: any) {
        console.error("✗ Migration failed:", error.message);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

main()
    .then(() => {
        console.log("Script completed successfully");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Script failed:", error);
        process.exit(1);
    });
