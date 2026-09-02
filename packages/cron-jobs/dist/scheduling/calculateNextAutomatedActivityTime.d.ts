import type { PrismaClient } from "@prisma/client";
export type CustomerScheduleInput = {
    account_id: number;
    last_automated_step: number;
    period_start_date: Date;
    previous_category?: string | null;
};
/**
 * Port of CustomerService.calculateNextAutomatedActivityTime (Prisma-only, no LogService).
 */
export declare function calculateNextAutomatedActivityTime(prisma: PrismaClient, customerDetailsMap: Map<number, CustomerScheduleInput>): Promise<Map<number, {
    schedule_time: Date;
    schedule_calculation: string;
}>>;
