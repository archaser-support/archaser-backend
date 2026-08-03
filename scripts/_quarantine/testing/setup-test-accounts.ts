#!/usr/bin/env tsx

/**
 * Account & User Provisioning Utility for Stress Tests
 *
 * Creates test accounts and users with runId-based identifiers for stress testing.
 * All resources are tagged with [STRESS_TEST][runId] for easy cleanup.
 */

import bcrypt from "bcryptjs";
import crypto from "crypto";

import { prisma } from "@/lib/prisma";
import { AccountService } from "@/server/services/AccountService";
import { BusinessUnitService } from "@/server/services/BusinessUnitService";
import { createUser } from "@/server/services/UserService";
import { processWithConcurrencyLimit } from "@/utils/concurrencyLimiter";

export interface TestUser {
    accountId: number;
    userId: string;
    email: string;
    password: string;
    businessUnitId: number | null;
    accountName: string;
    subdomain: string;
}

export interface SetupResult {
    runId: string;
    users: TestUser[];
}

const DEFAULT_PASSWORD = "TestPassword123!";

/**
 * Generate a unique run ID (timestamp + random suffix)
 */
export function generateRunId(): string {
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(4).toString("hex");
    return `${timestamp}-${randomSuffix}`;
}

/**
 * Get or create a system user for account creation
 */
async function getSystemUserId(runId: string): Promise<string | undefined> {
    try {
        // Try to find an admin user from account 10013
        const adminUser = await prisma.user.findFirst({
            where: {
                account_id: 10013,
                role: "archaser_admin",
                status: "Active",
            },
            select: { id: true },
        });

        if (!adminUser) {
            console.warn(`[${runId}] No admin user found in account 10013`);
        }

        return adminUser?.id;
    } catch (error: any) {
        const isConnectionError =
            error.message?.includes("Too many database connections") ||
            error.message?.includes("connection slots are reserved");

        if (isConnectionError) {
            console.error(
                `[${runId}] ❌ Connection pool exhausted while getting system user ID. ` +
                    `Error: ${error.message}`
            );
            throw new Error(
                `Database connection pool exhausted. Cannot proceed with account creation. ` +
                    `Please wait for connections to free up or reduce test concurrency.`
            );
        }
        throw error;
    }
}

/**
 * Create a single test account with timeout
 */
async function createTestAccount(
    index: number,
    runId: string,
    maxConcurrency: number
): Promise<{ accountId: number; businessUnitId: number | null }> {
    const accountName = `[STRESS_TEST][${runId}] Account ${index + 1}`;
    const subdomain = `stress-test-${runId}-${index + 1}`;
    const companyNumber = `STRESS_TEST_${runId}_${index + 1}`;

    console.log(`[${runId}] Creating account ${index + 1}...`);

    // Get system user ID for account creation
    const systemUserId = await getSystemUserId(runId);
    if (!systemUserId) {
        console.warn(
            `[${runId}] No system user found, account creation may fail`
        );
    }

    console.log(
        `[${runId}] Account ${index + 1}: Calling AccountService.createCustomer...`
    );
    const startTime = Date.now();

    // Add timeout wrapper (15 seconds for account creation - reduced for faster feedback)
    const ACCOUNT_CREATION_TIMEOUT = 15000; // 15 seconds
    const accountCreationPromise = AccountService.createCustomer(
        {
            name: accountName,
            company_number: companyNumber,
            status: "Active",
            promise_to_pay: 14,
            sub_domain: subdomain,
            client_type: "All",
            default_language: "English",
            locale: "en-US",
            currency: "USD",
        },
        systemUserId // Use admin user ID if available
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
            reject(
                new Error(
                    `Account creation timeout after ${ACCOUNT_CREATION_TIMEOUT}ms`
                )
            );
        }, ACCOUNT_CREATION_TIMEOUT);
    });

    const account = await Promise.race([
        accountCreationPromise,
        timeoutPromise,
    ]);

    const accountCreationTime = Date.now() - startTime;
    console.log(
        `[${runId}] Account ${index + 1}: Created in ${accountCreationTime}ms (ID: ${account.id})`
    );

    // Get the primary business unit that was created
    console.log(`[${runId}] Account ${index + 1}: Fetching business units...`);
    const businessUnits = await BusinessUnitService.getBusinessUnitsByAccount(
        account.id
    );
    const primaryBusinessUnit =
        businessUnits.find((bu) => !bu.parent_id) || null;
    console.log(
        `[${runId}] Account ${index + 1}: Business unit found: ${primaryBusinessUnit?.id || "none"}`
    );

    // Grant import permissions to Collection_Agent role for stress tests
    // This allows test users to perform imports without permission errors
    try {
        const { PermissionService } = await import(
            "@/server/services/PermissionService"
        );
        const permissionService = PermissionService.getInstance();

        // Get existing permissions for the role
        const existingPermissions = await permissionService.getRolePermissions(
            account.id,
            "Collection_Agent"
        );

        // Add import permissions if not already present
        const importPermissions = [
            "import_customer",
            "import_invoice",
            "import_contact",
            "import_payment",
            "import_policy",
        ];

        const permissionsToAdd = importPermissions.filter(
            (perm) => !existingPermissions.includes(perm)
        );

        if (permissionsToAdd.length > 0) {
            const allPermissions = [
                ...existingPermissions,
                ...permissionsToAdd,
            ];
            await permissionService.updateRolePermissions(
                account.id,
                "Collection_Agent",
                allPermissions,
                systemUserId || "system"
            );
            console.log(
                `[${runId}] Granted import permissions to Collection_Agent role for account ${account.id}: ${permissionsToAdd.join(", ")}`
            );
        }
    } catch (error: any) {
        // Log but don't fail - permissions might already exist or there might be a setup issue
        console.warn(
            `[${runId}] Warning: Could not grant import permissions for account ${account.id}: ${error.message}`
        );
    }

    return {
        accountId: account.id,
        businessUnitId: primaryBusinessUnit?.id || null,
    };
}

/**
 * Create a single test user for an account
 */
async function createTestUser(
    accountId: number,
    index: number,
    runId: string,
    businessUnitId: number | null
): Promise<TestUser> {
    const email = `stress-test-user${index + 1}-${runId}@test.local`;
    const firstName = `Test${index + 1}`;
    const lastName = `User${runId.substring(0, 8)}`;

    // Create user with generated password
    const user = await createUser({
        email,
        first_name: firstName,
        last_name: lastName,
        role: "Collection_Agent",
        status: "Active",
        account_id: accountId,
        language: "English",
        locale: "en-US",
        time_zone: "America/New_York",
        business_unit_id: businessUnitId,
        created_by: undefined,
        modified_by: undefined,
    });

    // Update password to known value for scripted login
    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
    });

    // Verify password was set correctly (for debugging)
    const updatedUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { password: true },
    });

    if (!updatedUser?.password) {
        throw new Error(`Failed to set password for user ${user.id}`);
    }

    // Verify password hash is correct
    const passwordMatches = await bcrypt.compare(
        DEFAULT_PASSWORD,
        updatedUser.password
    );
    if (!passwordMatches) {
        throw new Error(`Password verification failed for user ${user.id}`);
    }

    // Verify user can be found by email (as NextAuth does)
    const foundUser = await prisma.user.findFirst({
        where: {
            email,
            deactivated_at: null,
        },
        select: {
            id: true,
            email: true,
            password: true,
            status: true,
            freeze: true,
        },
    });

    if (!foundUser) {
        throw new Error(`User ${email} not found or is deactivated`);
    }

    if (foundUser.status !== "Active") {
        throw new Error(
            `User ${email} status is ${foundUser.status}, expected Active`
        );
    }

    if (foundUser.freeze === true) {
        throw new Error(`User ${email} is frozen`);
    }

    if (!foundUser.password) {
        throw new Error(`User ${email} has no password set`);
    }

    // Final password verification
    const finalPasswordCheck = await bcrypt.compare(
        DEFAULT_PASSWORD,
        foundUser.password
    );
    if (!finalPasswordCheck) {
        throw new Error(`Final password check failed for user ${email}`);
    }

    // Small delay to ensure database transaction is committed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get account details for return
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { name: true, sub_domain: true },
    });

    return {
        accountId,
        userId: user.id,
        email,
        password: DEFAULT_PASSWORD,
        businessUnitId,
        accountName: account?.name || "",
        subdomain: account?.sub_domain || "",
    };
}

/**
 * Ensure import permissions are granted for Collection_Agent role in an account
 */
async function ensureImportPermissions(
    accountId: number,
    runId: string
): Promise<void> {
    try {
        const { PermissionService } = await import(
            "@/server/services/PermissionService"
        );
        const permissionService = PermissionService.getInstance();

        // Get existing permissions for the role
        const existingPermissions = await permissionService.getRolePermissions(
            accountId,
            "Collection_Agent"
        );

        // Add import permissions if not already present
        const importPermissions = [
            "import_customer",
            "import_invoice",
            "import_contact",
            "import_payment",
            "import_policy",
        ];

        const permissionsToAdd = importPermissions.filter(
            (perm) => !existingPermissions.includes(perm)
        );

        if (permissionsToAdd.length > 0) {
            const allPermissions = [
                ...existingPermissions,
                ...permissionsToAdd,
            ];

            // Get system user ID for permission update
            const systemUserId = await getSystemUserId(runId);

            await permissionService.updateRolePermissions(
                accountId,
                "Collection_Agent",
                allPermissions,
                systemUserId || "system"
            );
            console.log(
                `[${runId}] ✅ Granted import permissions to Collection_Agent role for account ${accountId}: ${permissionsToAdd.join(", ")}`
            );
        } else {
            console.log(
                `[${runId}] ✅ Account ${accountId} already has all import permissions`
            );
        }
    } catch (error: any) {
        // Log but don't fail - permissions might already exist or there might be a setup issue
        console.warn(
            `[${runId}] ⚠️  Could not ensure import permissions for account ${accountId}: ${error.message}`
        );
    }
}

/**
 * Find existing test accounts that start with [STRESS_TEST]
 */
async function findExistingTestAccounts(
    runId: string,
    requiredCount: number
): Promise<
    Array<{
        accountId: number;
        businessUnitId: number | null;
        accountName: string;
        subdomain: string;
    }>
> {
    try {
        const accounts = await prisma.account.findMany({
            where: {
                name: {
                    startsWith: "[STRESS_TEST]",
                },
            },
            select: {
                id: true,
                name: true,
                sub_domain: true,
            },
            take: requiredCount,
            orderBy: {
                created_at: "desc", // Get most recently created test accounts
            },
        });

        console.log(
            `[${runId}] Found ${accounts.length} existing test accounts`
        );

        // Get business units for each account and ensure permissions
        const accountsWithBusinessUnits = await Promise.all(
            accounts.map(async (account) => {
                const businessUnit = await prisma.businessUnit.findFirst({
                    where: {
                        account_id: account.id,
                    },
                    select: {
                        id: true,
                    },
                    orderBy: {
                        created_at: "asc", // Get the first/default business unit
                    },
                });

                // Ensure import permissions are granted for this account
                await ensureImportPermissions(account.id, runId);

                return {
                    accountId: account.id,
                    businessUnitId: businessUnit?.id || null,
                    accountName: account.name || "",
                    subdomain: account.sub_domain || "",
                };
            })
        );

        return accountsWithBusinessUnits;
    } catch (error: any) {
        console.error(
            `[${runId}] Error finding existing test accounts:`,
            error.message
        );
        return [];
    }
}

/**
 * Find or create a test user for an existing account
 */
async function findOrCreateTestUser(
    accountId: number,
    businessUnitId: number | null,
    index: number,
    runId: string
): Promise<TestUser> {
    // First, try to find an existing Collection_Agent user in this account
    const existingUser = await prisma.user.findFirst({
        where: {
            account_id: accountId,
            role: "Collection_Agent",
            status: "Active",
            deactivated_at: null,
            email: {
                contains: "stress-test",
            },
        },
        select: {
            id: true,
            email: true,
            business_unit_id: true,
        },
        orderBy: {
            created_at: "desc",
        },
    });

    if (existingUser) {
        // Update password to known value for scripted login
        const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
        await prisma.user.update({
            where: { id: existingUser.id },
            data: { password: hashedPassword },
        });

        // Get account details
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { name: true, sub_domain: true },
        });

        console.log(
            `[${runId}] ✅ Using existing user ${existingUser.email} for account ${accountId}`
        );

        return {
            accountId,
            userId: existingUser.id,
            email:
                existingUser.email ||
                `stress-test-user${index + 1}-${runId}@test.local`,
            password: DEFAULT_PASSWORD,
            businessUnitId: existingUser.business_unit_id,
            accountName: account?.name || "",
            subdomain: account?.sub_domain || "",
        };
    }

    // No existing user found, create a new one
    console.log(
        `[${runId}] No existing user found for account ${accountId}, creating new user...`
    );
    return await createTestUser(accountId, index, runId, businessUnitId);
}

/**
 * Setup test accounts and users
 *
 * @param userCount Number of accounts/users to create
 * @param runId Optional run ID (will generate if not provided)
 * @param maxConcurrency Maximum concurrent operations (default: 5)
 * @returns Setup result with runId and user metadata
 */
export async function setupTestAccounts(
    userCount: number,
    runId?: string,
    maxConcurrency: number = 5
): Promise<SetupResult> {
    const finalRunId = runId || generateRunId();

    console.log(`[${finalRunId}] Looking for existing test accounts...`);
    const existingAccounts = await findExistingTestAccounts(
        finalRunId,
        userCount
    );

    let accountResults: Array<{
        accountId: number;
        businessUnitId: number | null;
    }>;
    let accountsToCreate = 0;

    if (existingAccounts.length >= userCount) {
        // We have enough existing accounts, use them
        console.log(
            `[${finalRunId}] ✅ Found ${existingAccounts.length} existing test accounts, using ${userCount} of them`
        );
        accountResults = existingAccounts.slice(0, userCount).map((acc) => ({
            accountId: acc.accountId,
            businessUnitId: acc.businessUnitId,
        }));
    } else {
        // We have some existing accounts but need more
        accountsToCreate = userCount - existingAccounts.length;
        console.log(
            `[${finalRunId}] Found ${existingAccounts.length} existing test accounts, need to create ${accountsToCreate} more`
        );

        // Use existing accounts
        accountResults = existingAccounts.map((acc) => ({
            accountId: acc.accountId,
            businessUnitId: acc.businessUnitId,
        }));

        // Create additional accounts
        console.log(
            `[${finalRunId}] Creating ${accountsToCreate} new test accounts...`
        );
        console.log(
            `[${finalRunId}] Using max concurrency: ${maxConcurrency} (consider reducing if stuck)`
        );

        // Create accounts with concurrency limit (reduce for production)
        // Production databases may be slower, so use lower concurrency
        const effectiveConcurrency = Math.min(maxConcurrency, 2); // Cap at 2 for production safety
        if (effectiveConcurrency < maxConcurrency) {
            console.log(
                `[${finalRunId}] ⚠️  Reduced concurrency from ${maxConcurrency} to ${effectiveConcurrency} for production safety`
            );
        }

        const accountIndices = Array.from(
            { length: accountsToCreate },
            (_, i) => i
        );
        const newAccountResults = await processWithConcurrencyLimit(
            accountIndices,
            async (index) => {
                try {
                    const startTime = Date.now();
                    const result = await createTestAccount(
                        existingAccounts.length + index,
                        finalRunId,
                        effectiveConcurrency
                    );
                    const duration = Date.now() - startTime;
                    console.log(
                        `[${finalRunId}] ✅ Account ${existingAccounts.length + index + 1} completed in ${duration}ms`
                    );
                    return result;
                } catch (error: any) {
                    const isConnectionError =
                        error.message?.includes(
                            "Too many database connections"
                        ) ||
                        error.message?.includes(
                            "connection slots are reserved"
                        );

                    if (isConnectionError) {
                        console.error(
                            `[${finalRunId}] ❌ Connection pool exhausted while creating account ${existingAccounts.length + index + 1}:`,
                            error.message
                        );
                        // Return a failed account marker instead of throwing
                        return {
                            accountId: -1, // Invalid account ID to mark as failed
                            businessUnitId: null,
                        };
                    }

                    console.error(
                        `[${finalRunId}] ❌ Failed to create account ${existingAccounts.length + index + 1}:`,
                        error.message
                    );
                    if (error.stack) {
                        console.error(
                            `[${finalRunId}] Stack trace:`,
                            error.stack
                        );
                    }
                    // Return failed marker instead of throwing to allow other accounts to be created
                    return {
                        accountId: -1,
                        businessUnitId: null,
                    };
                }
            },
            effectiveConcurrency
        );

        // Combine existing and new accounts
        accountResults = [...accountResults, ...newAccountResults];
        console.log(
            `[${finalRunId}] Total accounts available: ${accountResults.length} (${existingAccounts.length} existing + ${newAccountResults.length} new)`
        );
    }

    // Filter out failed accounts (those without accountId)
    const validAccounts = accountResults.filter((acc) => acc.accountId > 0);
    if (validAccounts.length === 0) {
        throw new Error(
            `No valid accounts created. All ${accountResults.length} account creation attempts failed. ` +
                `This is likely due to database connection pool exhaustion. ` +
                `Check database connection limits and current usage.`
        );
    }

    if (validAccounts.length < accountResults.length) {
        console.warn(
            `[${finalRunId}] ⚠️  Only ${validAccounts.length}/${accountResults.length} accounts are valid. ` +
                `Some accounts may have failed to create.`
        );
    }

    // Find or create users for valid accounts
    console.log(
        `[${finalRunId}] Finding or creating ${validAccounts.length} test users...`
    );
    const userResults = await processWithConcurrencyLimit(
        validAccounts.map((result, index) => ({
            accountId: result.accountId,
            businessUnitId: result.businessUnitId,
            index,
        })),
        async ({ accountId, businessUnitId, index }) => {
            try {
                return await findOrCreateTestUser(
                    accountId,
                    businessUnitId,
                    index,
                    finalRunId
                );
            } catch (error: any) {
                // Check if it's a connection pool error
                const isConnectionError =
                    error.message?.includes("Too many database connections") ||
                    error.message?.includes("connection slots are reserved");

                if (isConnectionError) {
                    console.error(
                        `[${finalRunId}] ❌ Connection pool exhausted while finding/creating user ${index + 1}. ` +
                            `Account ID: ${accountId}. Error: ${error.message}`
                    );
                    // Return a placeholder user object so we can continue (but it won't be valid for auth)
                    return {
                        accountId,
                        userId: `failed-${index}`,
                        email: undefined as any,
                        password: undefined as any,
                        businessUnitId,
                        accountName: `[FAILED] Account ${accountId}`,
                        subdomain: `failed-${finalRunId}-${index}`,
                    };
                }

                console.error(
                    `[${finalRunId}] Failed to find/create user ${index + 1}:`,
                    error.message
                );
                throw error;
            }
        },
        Math.min(maxConcurrency, 1) // Use concurrency of 1 for user creation to avoid connection exhaustion
    );

    // Filter out failed users
    const validUsers = userResults.filter(
        (u) => u.email && u.password && u.userId
    );
    console.log(
        `[${finalRunId}] Created ${validUsers.length} valid users (${userResults.length} total attempts)`
    );

    if (validUsers.length === 0) {
        throw new Error(
            `No valid users created. All ${userResults.length} user creation attempts failed. ` +
                `This is likely due to database connection pool exhaustion. ` +
                `Check database connection limits and current usage.`
        );
    }

    return {
        runId: finalRunId,
        users: validUsers,
    };
}

// Allow running as standalone script for testing
if (require.main === module) {
    const userCount = parseInt(process.argv[2] || "2", 10);
    setupTestAccounts(userCount)
        .then((result) => {
            console.log("\n✅ Setup complete!");
            console.log(`Run ID: ${result.runId}`);
            console.log(`Users created: ${result.users.length}`);
            console.log("\nUser details:");
            result.users.forEach((user, index) => {
                console.log(
                    `  ${index + 1}. ${user.email} (Account: ${user.accountId}, User: ${user.userId})`
                );
            });
            process.exit(0);
        })
        .catch((error) => {
            console.error("❌ Setup failed:", error);
            process.exit(1);
        });
}
