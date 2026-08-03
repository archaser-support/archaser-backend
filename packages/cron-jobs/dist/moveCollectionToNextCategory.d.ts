import type { PrismaClient } from "@prisma/client";
import type { CronJobResult } from "./handlers";
/**
 * Move collections to next category
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * server/cron-jobs/MoveCollectionToNextCategory.ts
 *
 * Algorithm:
 * Phase 1: Handle expired promises to pay
 * Phase 2: Process collections with next_category_date <= now and next_category is not null
 */
export declare function moveCollectionToNextCategory(prisma: PrismaClient): Promise<CronJobResult>;
