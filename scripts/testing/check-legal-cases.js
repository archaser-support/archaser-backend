import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkLegalCases() {
    try {
        console.log("Checking for legal cases in the database...\n");

        // Check total legal cases
        const totalLegalCases = await prisma.customerCollectionPeriod.count({
            where: {
                current_category: "Legal",
            },
        });

        console.log(`Total legal cases in database: ${totalLegalCases}`);

        if (totalLegalCases > 0) {
            // Get some sample legal cases
            const sampleLegalCases =
                await prisma.customerCollectionPeriod.findMany({
                    where: {
                        current_category: "Legal",
                    },
                    include: {
                        Customer: {
                            include: {
                                Person: true,
                                Company: true,
                                Country: true,
                                State: true,
                            },
                        },
                    },
                    take: 5,
                });

            console.log("\nSample legal cases:");
            sampleLegalCases.forEach((case_, index) => {
                const customer = case_.Customer;
                const customerName = customer.Person
                    ? `${customer.Person.first_name} ${customer.Person.last_name}`.trim()
                    : customer.Company?.name || "Unknown";

                console.log(
                    `${index + 1}. Customer: ${customerName} (ID: ${customer.id})`
                );
                console.log(`   Customer ID: ${customer.account_id}`);
                console.log(
                    `   Outstanding Amount: $${case_.total_outstanding_amount || 0}`
                );
                console.log(`   Created: ${case_.created_at}`);
                console.log("");
            });
        }

        // Check customers
        const customers = await prisma.customer.findMany({
            take: 5,
        });

        console.log("Available accounts:");
        customers.forEach((customer) => {
            console.log(`- ID: ${customer.id}, Name: ${customer.name}`);
        });
    } catch (error) {
        console.error("Error checking legal cases:", error);
    } finally {
        await prisma.$disconnect();
    }
}

checkLegalCases();
