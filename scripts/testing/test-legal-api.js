import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function testLegalAPI() {
    try {
        console.log("Testing legal API logic...\n");

        // Simulate the API logic with account_id 10081 (which has legal cases)
        const account_id = 10081;

        console.log(`Testing with account_id: ${account_id}`);

        // Check if there are any legal cases for this customer
        const legalCasesCount = await prisma.customerCollectionPeriod.count({
            where: {
                current_category: "Legal",
                Customer: {
                    account_id: account_id,
                },
            },
        });

        console.log(
            `Total legal cases for customer ${account_id}: ${legalCasesCount}`
        );

        if (legalCasesCount === 0) {
            console.log("No legal cases found for this customer");
            return;
        }

        // Test the main query
        const where = {
            account_id,
            CustomerCollectionPeriod: {
                some: {
                    current_category: "Legal",
                },
            },
        };

        console.log("Testing main query...");

        const [customers, totalRecords, totalAmountResult] = await Promise.all([
            prisma.customer.findMany({
                skip: 0,
                take: 10,
                where,
                orderBy: { id: "desc" },
                include: {
                    Person: true,
                    Company: true,
                    Country: true,
                    State: true,
                    CustomerCollectionPeriod: {
                        where: {
                            current_category: "Legal",
                        },
                        orderBy: {
                            created_at: "desc",
                        },
                        take: 1,
                    },
                },
            }),
            prisma.customer.count({ where }),
            prisma.customerCollectionPeriod.aggregate({
                where: {
                    current_category: "Legal",
                    Customer: {
                        account_id: account_id,
                    },
                },
                _sum: {
                    total_outstanding_amount: true,
                },
            }),
        ]);

        console.log(`Query successful!`);
        console.log(`- Found customers: ${customers.length}`);
        console.log(`- Total records: ${totalRecords}`);
        console.log(
            `- Total outstanding amount: $${totalAmountResult._sum.total_outstanding_amount || 0}`
        );

        // Transform the data (same as in the API)
        const legalCases = customers.map((customer) => {
            const collectionPeriod = customer.CustomerCollectionPeriod[0];
            const customerName = customer.Person
                ? `${customer.Person.first_name} ${customer.Person.last_name}`.trim()
                : customer.Company?.name || "Unknown";

            const daysPastDue = collectionPeriod?.oldest_invoice_overdue_date
                ? Math.ceil(
                      (new Date().getTime() -
                          new Date(
                              collectionPeriod.oldest_invoice_overdue_date
                          ).getTime()) /
                          (1000 * 60 * 60 * 24)
                  )
                : 0;

            return {
                id: customer.id,
                customer_id: customer.id,
                customer: customerName,
                customer_number: customer.customer_number || "",
                amount_overdue: collectionPeriod?.total_outstanding_amount || 0,
                amount_formatted: `$${(collectionPeriod?.total_outstanding_amount || 0).toLocaleString()}`,
                days_past_due: daysPastDue,
                customer_country: customer.Country?.name || "Unknown",
                customer_state: customer.State?.name || "",
                customer_current_time: "",
                last_call: collectionPeriod?.last_call,
                last_call_result: collectionPeriod?.last_call_result,
                period_start_date: collectionPeriod?.period_start_date,
                period_end_date: collectionPeriod?.period_end_date,
                currency: collectionPeriod?.currency || "USD",
                date_moved_to_legal: collectionPeriod?.created_at,
            };
        });

        console.log("\nTransformed legal cases:");
        legalCases.forEach((case_, index) => {
            console.log(
                `${index + 1}. ${case_.customer} - $${case_.amount_overdue}`
            );
        });

        console.log("\n✅ API logic test completed successfully!");
    } catch (error) {
        console.error("❌ Error testing legal API:", error);
    } finally {
        await prisma.$disconnect();
    }
}

testLegalAPI();
