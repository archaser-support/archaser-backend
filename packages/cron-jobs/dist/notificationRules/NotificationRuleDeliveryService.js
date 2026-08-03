"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationRuleDeliveryService = void 0;
const NotificationService_1 = require("./NotificationService");
const CreditNotificationEmailService_1 = require("./CreditNotificationEmailService");
const NotificationDeliveryLogService_1 = require("./NotificationDeliveryLogService");
const NotificationRuleEvaluator_1 = require("./NotificationRuleEvaluator");
const creditDomain_1 = require("../creditDomain");
function parseEntityFromDedupKey(dedupKey) {
    const parts = dedupKey.split(":");
    const entityTypeIndex = parts.findIndex((part) => part === "customer" || part === "invoice");
    if (entityTypeIndex < 0 || entityTypeIndex + 1 >= parts.length) {
        return null;
    }
    const entityType = parts[entityTypeIndex];
    const entityId = parts[entityTypeIndex + 1];
    const offsetIndex = parts.findIndex((part) => part === "offset");
    const offsetDays = offsetIndex >= 0 && offsetIndex + 1 < parts.length
        ? Number.parseInt(parts[offsetIndex + 1], 10)
        : null;
    return {
        entityType,
        entityId,
        offsetDays: Number.isFinite(offsetDays) ? offsetDays : null,
    };
}
function intentToQualificationKey(intent) {
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
class NotificationRuleDeliveryService {
    constructor(prisma, ledger, notifications, creditEmail, fetchUncoveredCustomerIds) {
        this.prisma = prisma;
        this.ledger = ledger;
        this.notifications = notifications;
        this.creditEmail = creditEmail;
        this.fetchUncoveredCustomerIds = fetchUncoveredCustomerIds;
    }
    async processCreditAccount(input) {
        const now = input.now ?? new Date();
        const provider = new NotificationRuleEvaluator_1.PrismaNotificationRuleEvaluatorProvider(this.prisma, this.fetchUncoveredCustomerIds, {
            isDedupActive: (dedupKey) => this.ledger.isActive(dedupKey),
        });
        const evaluator = new NotificationRuleEvaluator_1.NotificationRuleEvaluator(provider);
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
            const wasDelivered = await this.deliverIntent(input.accountId, intent);
            if (wasDelivered) {
                delivered += 1;
            }
            else {
                skipped += 1;
            }
        }
        const cleared = await this.ledger.clearStaleEntries(input.accountId, activeKeys);
        return {
            delivered,
            skipped,
            cleared,
            intentsEvaluated: intents.length,
        };
    }
    async deliverIntent(accountId, intent) {
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
        }
        else if (intent.channel === "email") {
            const sent = await this.creditEmail.sendCreditAlertEmail({
                accountId,
                intent,
            });
            if (!sent) {
                return false;
            }
        }
        else {
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
    async processAllCreditInsuranceAccounts(input) {
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
        for (const account of accounts) {
            const enabledRuleCount = await this.prisma.notificationRuleSet.count({
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
        return { accountsProcessed, delivered, skipped, cleared };
    }
    static async createService(prisma) {
        (0, creditDomain_1.bindCreditDomain)(prisma);
        const { fetchUncoveredCustomerIdsForAccount } = (0, creditDomain_1.requireCreditDomainModule)("domain/termBreachResolver.js");
        return new NotificationRuleDeliveryService(prisma, new NotificationDeliveryLogService_1.NotificationDeliveryLogService(prisma), new NotificationService_1.NotificationService(prisma), new CreditNotificationEmailService_1.CreditNotificationEmailService(prisma), fetchUncoveredCustomerIdsForAccount);
    }
}
exports.NotificationRuleDeliveryService = NotificationRuleDeliveryService;
