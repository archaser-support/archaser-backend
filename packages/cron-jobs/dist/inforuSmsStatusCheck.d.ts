import type { PrismaClient } from "@prisma/client";
import type { CronJobResult } from "./handlers";
/**
 * Check SMS delivery status for pending Inforu messages
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * server/services/InforuStatusChecker.ts
 */
export declare function checkInforuSmsStatus(prisma: PrismaClient): Promise<CronJobResult>;
