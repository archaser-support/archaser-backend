"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationRuleSetService = void 0;
const CREDIT_PRODUCT = "credit_insurance";
const ACTION_WINDOW_TRIGGER = "action_window";
const DEFAULT_ACTION_WINDOW_OFFSETS = [14, 7, 3];
const DEFAULT_ROLES = [
    "CFO",
    "Data_Analyst",
    "System_Administrator",
];
const CREDIT_TRIGGERS = [
    "overdue_block",
    "capacity_gap",
    "entry_terms_breach",
    "action_window",
    "limit_warnings",
];
function normalizeOffsets(input) {
    if (!Array.isArray(input)) {
        throw new Error("advance_day_offsets must be an array of integers");
    }
    const parsed = input.map((v) => Number.parseInt(String(v), 10));
    if (parsed.some((v) => !Number.isFinite(v) || v < 0 || v > 365)) {
        throw new Error("advance_day_offsets must contain integers between 0 and 365");
    }
    return Array.from(new Set(parsed)).sort((a, b) => b - a);
}
function parseUserOverrideIds(input) {
    if (!Array.isArray(input)) {
        throw new Error("user_override_user_ids must be an array");
    }
    const ids = input
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0);
    return Array.from(new Set(ids));
}
class NotificationRuleSetService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async seedDefaultCreditRuleSetsForAccount(tx, accountId, actorUserId = "system") {
        for (const triggerType of CREDIT_TRIGGERS) {
            const ruleSet = await tx.notificationRuleSet.upsert({
                where: {
                    account_id_product_trigger_type: {
                        account_id: accountId,
                        product: CREDIT_PRODUCT,
                        trigger_type: triggerType,
                    },
                },
                update: {
                    modified_at: new Date(),
                    modified_by: actorUserId,
                },
                create: {
                    account_id: accountId,
                    product: CREDIT_PRODUCT,
                    trigger_type: triggerType,
                    enabled: true,
                    created_by: actorUserId,
                    modified_by: actorUserId,
                },
            });
            const rule = await tx.notificationRule.upsert({
                where: { rule_set_id: ruleSet.id },
                update: {
                    modified_at: new Date(),
                    modified_by: actorUserId,
                },
                create: {
                    rule_set_id: ruleSet.id,
                    advance_day_offsets: triggerType === ACTION_WINDOW_TRIGGER
                        ? DEFAULT_ACTION_WINDOW_OFFSETS
                        : [],
                    created_by: actorUserId,
                    modified_by: actorUserId,
                },
            });
            await tx.notificationRuleRoleDefault.createMany({
                data: DEFAULT_ROLES.map((role) => ({
                    rule_id: rule.id,
                    role,
                    created_by: actorUserId,
                    modified_by: actorUserId,
                })),
                skipDuplicates: true,
            });
        }
    }
    async getCreditRuleSets(accountId) {
        const ruleSets = await this.prisma.notificationRuleSet.findMany({
            where: { account_id: accountId, product: CREDIT_PRODUCT },
            include: {
                rules: {
                    include: {
                        role_defaults: true,
                        user_overrides: {
                            where: { active: true },
                            orderBy: { user_id: "asc" },
                        },
                    },
                },
            },
            orderBy: { trigger_type: "asc" },
        });
        return ruleSets.map((set) => ({
            id: set.id,
            account_id: set.account_id,
            product: set.product,
            trigger_type: set.trigger_type,
            enabled: set.enabled,
            rules: set.rules.map((rule) => ({
                id: rule.id,
                advance_day_offsets: rule.advance_day_offsets || [],
                role_defaults: rule.role_defaults.map((item) => item.role),
                user_overrides: rule.user_overrides.map((item) => ({
                    id: item.id,
                    user_id: item.user_id,
                })),
            })),
        }));
    }
    async updateCreditRuleSet(input) {
        const { accountId, setId, actorUserId } = input;
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.notificationRuleSet.findFirst({
                where: {
                    id: setId,
                    account_id: accountId,
                    product: CREDIT_PRODUCT,
                },
                include: { rules: true },
            });
            if (!existing) {
                throw new Error("NOT_FOUND");
            }
            if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
                throw new Error("enabled must be a boolean");
            }
            if (input.enabled !== undefined) {
                await tx.notificationRuleSet.update({
                    where: { id: setId },
                    data: {
                        enabled: input.enabled,
                        modified_by: actorUserId,
                        modified_at: new Date(),
                    },
                });
            }
            let rule = existing.rules[0];
            if (!rule) {
                rule = await tx.notificationRule.create({
                    data: {
                        rule_set_id: existing.id,
                        advance_day_offsets: existing.trigger_type === ACTION_WINDOW_TRIGGER
                            ? DEFAULT_ACTION_WINDOW_OFFSETS
                            : [],
                        created_by: actorUserId,
                        modified_by: actorUserId,
                    },
                });
            }
            if (input.advance_day_offsets !== undefined) {
                if (existing.trigger_type !== ACTION_WINDOW_TRIGGER) {
                    throw new Error("advance_day_offsets can only be updated for action_window rules");
                }
                await tx.notificationRule.update({
                    where: { id: rule.id },
                    data: {
                        advance_day_offsets: normalizeOffsets(input.advance_day_offsets),
                        modified_by: actorUserId,
                        modified_at: new Date(),
                    },
                });
            }
            if (input.user_override_user_ids !== undefined) {
                const nextUserIds = parseUserOverrideIds(input.user_override_user_ids);
                const activeRows = await tx.notificationRuleUserOverride.findMany({
                    where: { rule_id: rule.id, active: true },
                    select: { user_id: true },
                });
                const activeSet = new Set(activeRows.map((row) => String(row.user_id)));
                const nextSet = new Set(nextUserIds);
                const deactivateIds = Array.from(activeSet).filter((id) => !nextSet.has(id));
                if (deactivateIds.length > 0) {
                    await tx.notificationRuleUserOverride.updateMany({
                        where: {
                            rule_id: rule.id,
                            user_id: { in: deactivateIds },
                            active: true,
                        },
                        data: {
                            active: false,
                            modified_by: actorUserId,
                            modified_at: new Date(),
                        },
                    });
                }
                for (const userId of nextUserIds) {
                    await tx.notificationRuleUserOverride.upsert({
                        where: {
                            rule_id_user_id: { rule_id: rule.id, user_id: userId },
                        },
                        update: {
                            active: true,
                            modified_by: actorUserId,
                            modified_at: new Date(),
                        },
                        create: {
                            rule_id: rule.id,
                            user_id: userId,
                            active: true,
                            created_by: actorUserId,
                            modified_by: actorUserId,
                        },
                    });
                }
            }
            return this.getCreditRuleSets(accountId);
        });
    }
}
exports.NotificationRuleSetService = NotificationRuleSetService;
