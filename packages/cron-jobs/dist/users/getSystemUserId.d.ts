import type { PrismaClient } from "@prisma/client";
/**
 * Resolve a user id for system-generated activity audit fields.
 * Prefers deactivated=false user with "system" in email, then account admins.
 * Returns null when no suitable user exists (caller should skip or throw).
 */
export declare function getSystemUserId(prisma: PrismaClient, accountId: number): Promise<string | null>;
