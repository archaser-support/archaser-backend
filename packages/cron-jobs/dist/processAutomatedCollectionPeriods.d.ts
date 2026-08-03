import type { PrismaClient } from "@prisma/client";
import type { CronJobResult } from "./handlers";
/**
 * Process Automated Collection Periods
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * server/cron-jobs/processAutomatedCollectionPeriods.ts
 *
 * BEST-EFFORT PORT: Prisma-only phases
 *
 * Algorithm:
 * Phase 0: Sequence Reset - Enable activity creation for manually changed Automated periods
 * Phase 1: Mark Last Steps - Mark activities/periods at last automated step
 * Phase 2: Prepare Next Activities - Enable next activity creation flag
 * Phase 3: Transition Setup - Set next_category for completed Automated periods
 *
 * SKIPPED (require Activity Workflow Manager):
 * - Activity creation (createAutomatedActivity)
 * - Email/SMS sending
 * - Complex activity timeline logic
 * - CustomerService.calculateNextAutomatedActivityTime (complex date calc)
 */
export declare function processAutomatedCollectionPeriods(prisma: PrismaClient): Promise<CronJobResult>;
