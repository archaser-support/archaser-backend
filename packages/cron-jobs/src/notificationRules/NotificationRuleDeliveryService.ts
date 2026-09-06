import type { PrismaClient } from "@prisma/client";
import { NotificationService } from "./NotificationService";
import { CreditNotificationEmailService } from "./CreditNotificationEmailService";
import {
    NotificationDeliveryLogService,
    type ActiveQualificationKey,
} from "./NotificationDeliveryLogService";
import {
    NotificationRuleEvaluator,
    PrismaNotificationRuleEvaluatorProvider,
    type NotificationDeliveryIntent,
} from "./NotificationRuleEvaluator";
import {
    bindCreditInsurancePrisma,
    fetchUncoveredCustomerIdsForAccount,
} from "@archaser/credit-insurance-domain";

function parseEntityFromDedupKey(
    dedupKey: string
):
    | {
          entityType: "customer" | "invoice";
          entityId: string;
          offsetDays: number | null;
      }
    | null {
    const parts = dedupKey.split(":");
    const entityTypeIndex = parts.findIndex(
        (part) => part === "customer" || part === "invoice"
    );
    if (entityTypeIndex < 0 || entityTypeIndex + 1 >= parts.length) {
        return null;
    }
    const entityType = parts[entityTypeIndex] as "customer" | "invoice";
    const entityId = parts[entityTypeIndex + 1];
    const offsetIndex = parts.findIndex((part) => part === "offset");
    const offsetDays =
        offsetIndex >= 0 && offsetIndex + 1 < parts.length
            ? Number.parseInt(parts[offsetIndex + 1], 10)
            : null;
    return {
        entityType,
        entityId,
        offsetDays: Number.isFinite(offsetDays) ? offsetDays : null,
    };
}

function intentToQualificationKey(
    intent: NotificationDeliveryIntent
): ActiveQualificationKey | null {
    const parsed = parseEntityFromDedupKey(intent.dedupKey);
    if (!parsed) {
        return null;
    }
    return {
        ruleId: intent.ruleId,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        offsetDays: parsed.offsetDays,
    };
}

export class NotificationRuleDeliveryService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly ledger: NotificationDeliveryLogService,
        private readonly notifications: NotificationService,
        private readonly creditEmail: CreditNotificationEmailService,
        private readonly fetchUncoveredCustomerIds: (
            accountId: number
        ) => Promise<Set<number>>
    ) {}

    async processCreditAccount(input: {
        accountId: number;
        now?: Date;
    }): Promise<{
        delivered: number;
        skipped: number;
        cleared: number;
        intentsEvaluated: number;
    }> {
        const now = input.now ?? new Date();
        const provider = new PrismaNotificationRuleEvaluatorProvider(
            this.prisma,
            this.fetchUncoveredCustomerIds,
            {
                isDedupActive: (dedupKey) => this.ledger.isActive(dedupKey),
            }
        );
        const evaluator = new NotificationRuleEvaluator(provider);

        const [intents, activeKeys] = await Promise.all([
            evaluator.evaluateCreditAccount({ accountId: input.accountId, now }),
            evaluator.getActiveQualificationKeys({
                accountId: input.accountId,
                now,
                provider,
            }),
        ]);

        let delivered = 0;
        let skipped = 0;

        for (const intent of intents) {
            const wasDelivered = await this.deliverIntent(
                input.accountId,
                intent
            );
            if (wasDelivered) {
                delivered += 1;
            } else {
                skipped += 1;
            }
        }

        const cleared = await this.ledger.clearStaleEntries(
            input.accountId,
            activeKeys
        );

        return {
            delivered,
            skipped,
            cleared,
            intentsEvaluated: intents.length,
        };
    }

    private async deliverIntent(
        accountId: number,
        intent: NotificationDeliveryIntent
    ): Promise<boolean> {
        if (await this.ledger.isActive(intent.dedupKey)) {
            return false;
        }

        const qualification = intentToQualificationKey(intent);
        if (!qualification) {
            return false;
        }

        if (intent.channel === "in_app") {
            await this.notifications.createNotification({
                type: "Secondary",
                title: intent.title,
                message: intent.message,
                priority: intent.priority,
                userId: intent.recipientUserId,
                accountId,
                actionUrl: intent.actionUrl,
                metadata: {
                    ...intent.metadata,
                    trigger_type: intent.triggerType,
                    rule_id: intent.ruleId,
                    rule_set_id: intent.ruleSetId,
                    dedup_key: intent.dedupKey,
                },
            });
        } else if (intent.channel === "email") {
            const sent = await this.creditEmail.sendCreditAlertEmail({
                accountId,
                intent,
            });
            if (!sent) {
                return false;
            }
        } else {
            return false;
        }

        await this.ledger.recordDelivery({
            accountId,
            ruleId: intent.ruleId,
            entityType: qualification.entityType,
            entityId: qualification.entityId,
            offsetDays: qualification.offsetDays,
            dedupKey: intent.dedupKey,
            channel: intent.channel,
            metadata: intent.metadata,
        });

        return true;
    }

    async processAllCreditInsuranceAccounts(input?: {
        now?: Date;
        accountId?: number;
        excludeAccountIds?: ReadonlySet<number>;
    }): Promise<{
        accountsProcessed: number;
        delivered: number;
        skipped: number;
        cleared: number;
        skippedFrozenAccountIds: number[];
    }> {
        const accounts = await this.prisma.account.findMany({
            where: {
                has_credit_insurance: true,
                ...(input?.accountId != null ? { id: input.accountId } : {}),
            },
            select: { id: true },
        });

        let accountsProcessed = 0;
        let delivered = 0;
        let skipped = 0;
        let cleared = 0;
        const skippedFrozenAccountIds: number[] = [];

        for (const account of accounts) {
            if (input?.excludeAccountIds?.has(account.id)) {
                skippedFrozenAccountIds.push(account.id);
                continue;
            }
            const enabledRuleCount = await (
                this.prisma as any
            ).notificationRuleSet.count({
                where: {
                    account_id: account.id,
                    product: "credit_insurance",
                    enabled: true,
                },
            });
            if (enabledRuleCount === 0) {
                continue;
            }

            const result = await this.processCreditAccount({
                accountId: account.id,
                now: input?.now,
            });
            accountsProcessed += 1;
            delivered += result.delivered;
            skipped += result.skipped;
            cleared += result.cleared;
        }

        return {
            accountsProcessed,
            delivered,
            skipped,
            cleared,
            skippedFrozenAccountIds,
        };
    }

    static async createService(
        prisma: PrismaClient
    ): Promise<NotificationRuleDeliveryService> {
        bindCreditInsurancePrisma(prisma);

        return new NotificationRuleDeliveryService(
            prisma,
            new NotificationDeliveryLogService(prisma),
            new NotificationService(prisma),
            new CreditNotificationEmailService(prisma),
            fetchUncoveredCustomerIdsForAccount
        );
    }
}
