// Test script to verify database schema and total_due_amount field
import { PrismaClient } from '@prisma/client';

async function testDatabaseSchema() {
    console.log("Testing Database Schema for total_due_amount field");
    console.log("================================================");

    const prisma = new PrismaClient();

    try {
        // Test 1: Check if we can connect to the database
        console.log("\n1. Testing Database Connection");
        console.log("-------------------------------");
        await prisma.$connect();
        console.log("✅ Database connection successful");

        // Test 2: Try to query a customer with total_due_amount
        console.log("\n2. Testing total_due_amount Field Access");
        console.log("--------------------------------------");

        try {
            const customer = await prisma.customer.findFirst({
                select: {
                    id: true,
                    total_due_amount: true,
                    customer_uuid: true,
                    account_id: true
                }
            });

            if (customer) {
                console.log("✅ Successfully queried customer with total_due_amount");
                console.log(`   Customer ID: ${customer.id}`);
                console.log(`   total_due_amount: ${customer.total_due_amount}`);
                console.log(`   customer_uuid: ${customer.customer_uuid}`);
            } else {
                console.log("⚠️  No customers found in database");
            }
        } catch (fieldError) {
            console.log("❌ Error accessing total_due_amount field:");
            console.log(`   ${fieldError.message}`);

            // Test 3: Check what fields are actually available
            console.log("\n3. Checking Available Fields");
            console.log("----------------------------");

            try {
                const customer = await prisma.customer.findFirst({
                    select: {
                        id: true,
                        customer_uuid: true,
                        account_id: true
                    }
                });

                if (customer) {
                    console.log("✅ Basic customer fields are accessible");
                    console.log(`   Available fields: id, customer_uuid, account_id`);
                }
            } catch (basicError) {
                console.log("❌ Error accessing basic customer fields:");
                console.log(`   ${basicError.message}`);
            }
        }

        // Test 4: Check database schema directly
        console.log("\n4. Checking Database Schema");
        console.log("----------------------------");

        try {
            // Try to get table information
            const result = await prisma.$queryRaw`
                SELECT column_name, data_type, is_nullable 
                FROM information_schema.columns 
                WHERE table_name = 'Customer' 
                AND column_name = 'total_due_amount'
            `;

            if (result && result.length > 0) {
                console.log("✅ total_due_amount column exists in database");
                console.log(`   Column info:`, result[0]);
            } else {
                console.log("❌ total_due_amount column not found in database");
            }
        } catch (schemaError) {
            console.log("❌ Error checking database schema:");
            console.log(`   ${schemaError.message}`);
        }

    } catch (error) {
        console.log("❌ Database connection failed:");
        console.log(`   ${error.message}`);
    } finally {
        await prisma.$disconnect();
    }

    console.log(`\n${  "=".repeat(50)}`);
    console.log("DATABASE SCHEMA TEST COMPLETE");
    console.log("=".repeat(50));
}

// Run the test
testDatabaseSchema().catch(console.error);
