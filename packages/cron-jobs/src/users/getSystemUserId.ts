import type { PrismaClient } from "@prisma/client";

/**
 * Resolve a user id for system-generated activity audit fields.
 * Prefers deactivated=false user with "system" in email, then account admins.
 * Returns null when no suitable user exists (caller should skip or throw).
 */
export async function getSystemUserId(
    prisma: PrismaClient,
    accountId: number
): Promise<string | null> {
    const systemUser = await prisma.user.findFirst({
        where: {
            account_id: accountId,
            email: { contains: "system", mode: "insensitive" },
            deactivated_at: null,
        },
        select: { id: true },
        orderBy: { created_at: "asc" },
    });
    if (systemUser?.id) {
        return systemUser.id;
    }

    const adminUser = await prisma.user.findFirst({
        where: {
            account_id: accountId,
            deactivated_at: null,
            role: {
                in: [
                    "System_Administrator",
                    "archaser_admin",
                    "Account_Manager",
                    "Collection_Manager",
                ],
            },
        },
        select: { id: true },
        orderBy: { created_at: "asc" },
    });
    if (adminUser?.id) {
        return adminUser.id;
    }

    const anyActiveUser = await prisma.user.findFirst({
        where: {
            account_id: accountId,
            deactivated_at: null,
        },
        select: { id: true },
        orderBy: { created_at: "asc" },
    });

    return anyActiveUser?.id ?? null;
}
