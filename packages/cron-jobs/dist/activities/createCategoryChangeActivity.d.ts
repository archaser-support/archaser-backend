import type { PrismaClient } from "@prisma/client";
/**
 * Slim port of ActivityService.createCategoryChangeActivity for cron category moves.
 */
export declare function createCategoryChangeActivity(prisma: PrismaClient, params: {
    customerId: number;
    collectionId: number;
    accountId: number;
    currentCategory: string;
    nextCategory: string;
    userId?: string;
}): Promise<void>;
