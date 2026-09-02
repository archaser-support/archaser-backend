import type { PrismaClient, Prisma } from "@prisma/client";
export declare class NotificationRuleSetService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    seedDefaultCreditRuleSetsForAccount(tx: Prisma.TransactionClient, accountId: number, actorUserId?: string): Promise<void>;
    getCreditRuleSets(accountId: number): Promise<any>;
    updateCreditRuleSet(input: {
        accountId: number;
        setId: number;
        actorUserId: string;
        enabled?: unknown;
        advance_day_offsets?: unknown;
        user_override_user_ids?: unknown;
    }): Promise<any>;
}
