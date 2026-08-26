import type { PrismaClient } from "@prisma/client";
export interface MaturityResult {
    matured: number;
    deferredRemaining: number;
}
export declare function applyMaturedDeferredPayments(prisma: PrismaClient, accountId: number, asOf: Date, invoiceNumbers?: string[]): Promise<MaturityResult>;
