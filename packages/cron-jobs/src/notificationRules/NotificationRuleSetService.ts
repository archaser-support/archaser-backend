import type { PrismaClient, Prisma, user_role } from "@prisma/client";

const CREDIT_PRODUCT = "credit_insurance" as const;
const ACTION_WINDOW_TRIGGER = "action_window" as const;
const DEFAULT_ACTION_WINDOW_OFFSETS = [14, 7, 3];
const DEFAULT_ROLES: user_role[] = [
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
] as const;

function normalizeOffsets(input: unknown): number[] {
    if (!Array.isArray(input)) {
        throw new Error("advance_day_offsets must be an array of integers");
    }
    const parsed = input.map((v) => Number.parseInt(String(v), 10));
    if (parsed.some((v) => !Number.isFinite(v) || v < 0 || v > 365)) {
        throw new Error(
            "advance_day_offsets must contain integers between 0 and 365"
        );
    }
    return Array.from(new Set(parsed)).sort((a, b) => b - a);
}

function parseUserOverrideIds(input: unknown): string[] {
    if (!Array.isArray(input)) {
        throw new Error("user_override_user_ids must be an array");
    }
    const ids = input
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0);
    return Array.from(new Set(ids));
}

export class NotificationRuleSetService {
    constructor(private readonly prisma: PrismaClient) {}

    async seedDefaultCreditRuleSetsForAccount(
        tx: Prisma.TransactionClient,
        accountId: number,
        actorUserId = "system"
    ): Promise<void> {
        for (const triggerType of CREDIT_TRIGGERS) {
            const ruleSet = await (tx as any).notificationRuleSet.upsert({
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

            const rule = await (tx as any).notificationRule.upsert({
                where: { rule_set_id: ruleSet.id },
                update: {
                    modified_at: new Date(),
                    modified_by: actorUserId,
                },
                create: {
                    rule_set_id: ruleSet.id,
                    advance_day_offsets:
                        triggerType === ACTION_WINDOW_TRIGGER
                            ? DEFAULT_ACTION_WINDOW_OFFSETS
                            : [],
                    created_by: actorUserId,
                    modified_by: actorUserId,
                },
            });

            await (tx as any).notificationRuleRoleDefault.createMany({
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

    async getCreditRuleSets(accountId: number) {
        const ruleSets = await (this.prisma as any).notificationRuleSet.findMany(
            {
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
            } as any
        );

        return ruleSets.map((set: any) => ({
            id: set.id,
            account_id: set.account_id,
            product: set.product,
            trigger_type: set.trigger_type,
            enabled: set.enabled,
            rules: set.rules.map((rule: any) => ({
                id: rule.id,
                advance_day_offsets: rule.advance_day_offsets || [],
                role_defaults: rule.role_defaults.map((item: any) => item.role),
                user_overrides: rule.user_overrides.map((item: any) => ({
                    id: item.id,
                    user_id: item.user_id,
                })),
            })),
        }));
    }

    async updateCreditRuleSet(input: {
        accountId: number;
        setId: number;
        actorUserId: string;
        enabled?: unknown;
        advance_day_offsets?: unknown;
        user_override_user_ids?: unknown;
    }) {
        const { accountId, setId, actorUserId } = input;

        return this.prisma.$transaction(async (tx) => {
            const existing = await (tx as any).notificationRuleSet.findFirst({
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
                await (tx as any).notificationRuleSet.update({
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
                rule = await (tx as any).notificationRule.create({
                    data: {
                        rule_set_id: existing.id,
                        advance_day_offsets:
                            existing.trigger_type === ACTION_WINDOW_TRIGGER
                                ? DEFAULT_ACTION_WINDOW_OFFSETS
                                : [],
                        created_by: actorUserId,
                        modified_by: actorUserId,
                    },
                });
            }

            if (input.advance_day_offsets !== undefined) {
                if (existing.trigger_type !== ACTION_WINDOW_TRIGGER) {
                    throw new Error(
                        "advance_day_offsets can only be updated for action_window rules"
                    );
                }
                await (tx as any).notificationRule.update({
                    where: { id: rule.id },
                    data: {
                        advance_day_offsets: normalizeOffsets(
                            input.advance_day_offsets
                        ),
                        modified_by: actorUserId,
                        modified_at: new Date(),
                    },
                });
            }

            if (input.user_override_user_ids !== undefined) {
                const nextUserIds = parseUserOverrideIds(
                    input.user_override_user_ids
                );
                const activeRows = await (
                    tx as any
                ).notificationRuleUserOverride.findMany({
                    where: { rule_id: rule.id, active: true },
                    select: { user_id: true },
                });
                const activeSet = new Set<string>(
                    activeRows.map((row: any) => String(row.user_id))
                );
                const nextSet = new Set<string>(nextUserIds);

                const deactivateIds = Array.from(activeSet).filter(
                    (id) => !nextSet.has(id)
                );
                if (deactivateIds.length > 0) {
                    await (tx as any).notificationRuleUserOverride.updateMany({
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
                    await (tx as any).notificationRuleUserOverride.upsert({
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
