import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkUsers() {
    try {
        console.log("Checking users in the database...\n");

        // Get all users with their customer info
        const users = await prisma.user.findMany({
            include: {
                Customer: true,
            },
        });

        console.log(`Total users: ${users.length}\n`);

        users.forEach((user, index) => {
            console.log(`${index + 1}. User: ${user.email || "No email"}`);
            console.log(`   ID: ${user.id}`);
            console.log(
                `   Customer ID: ${user.account_id || "No customer ID"}`
            );
            console.log(
                `   Customer Name: ${user.Account?.name || "No customer"}`
            );
            console.log(`   Role: ${user.role || "No role"}`);
            console.log(`   Status: ${user.status}`);
            console.log("");
        });

        // Check for users with account_id 10081 specifically
        const usersWithCustomer10081 = users.filter(
            (user) => user.account_id === 10081
        );

        if (usersWithCustomer10081.length > 0) {
            console.log(
                `Users with account_id 10081 (${usersWithCustomer10081.length}):`
            );
            usersWithCustomer10081.forEach((user) => {
                console.log(`- ${user.email || "No email"} (ID: ${user.id})`);
            });
        } else {
            console.log("No users found with account_id 10081");
        }
    } catch (error) {
        console.error("Error checking users:", error);
    } finally {
        await prisma.$disconnect();
    }
}

checkUsers();
