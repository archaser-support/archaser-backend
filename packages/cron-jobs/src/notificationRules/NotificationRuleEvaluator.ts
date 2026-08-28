import type { Prisma, PrismaClient, user_role } from "@prisma/client";
import type { ActiveQualificationKey } from "./NotificationDeliveryLogService";
import { NotificationRuleSetService } from "./NotificationRuleSetService";

type TriggerType =
    | "overdue_block"
    | "capacity_gap"
    | "entry_terms_breach"
    | "action_window"
    | "limit_warnings";

type RuleSetView = {
    id: number;
    trigger_type: TriggerType;
    enabled: boolean;
    rules: Array<{
        id: number;
        advance_day_offsets: number[];
        role_defaults: user_role[];
        user_overrides: Array<{ user_id: string }>;
    }>;
};

type RecipientUser = {
    id: string;
    active: boolean;
};

type CustomerSignal = { customerId: number; customerNumber?: string | null };
type InvoiceSignal = {
    invoiceId: number;
    customerId: number | null;
    invoiceNumber?: string | null;
    targetReportingDate?: Date | null;
    reportingBreach?: boolean;
    hasZeroLimitWarning?: boolean;
};

/** Candidate where for reporting action-window notifications (excludes credit notes). */
export function actionWindowInvoiceWhere(
    accountId: number
): Prisma.InvoiceWhereInput {
    return {
        account_id: accountId,
        status: { in: ["Due", "Overdue"] },
        target_reporting_date: { not: null },
        actual_reporting_date: null,
        amount: { gte: 0 },
    };
}

export type NotificationDeliveryIntent = {
    ruleSetId: number;
    ruleId: number;
    triggerType: TriggerType;
    recipientUserId: string;
    channel: "in_app" | "email";
    dedupKey: string;
    title: string;
    message: string;
    actionUrl: string;
    metadata: Record<string, unknown>;
    priority: "Normal" | "High";
};

export interface NotificationRuleEvaluatorProvider {
    getRuleSets(accountId: number): Promise<RuleSetView[]>;
    getOverdueBlockCustomers(accountId: number): Promise<CustomerSignal[]>;
    getCapacityGapCustomers(accountId: number): Promise<CustomerSignal[]>;
    getLimitWarningCustomers(accountId: number): Promise<CustomerSignal[]>;
    getEntryTermsBreachInvoices(accountId: number): Promise<InvoiceSignal[]>;
    getActionWindowInvoices(accountId: number): Promise<InvoiceSignal[]>;
    getUsersByRoles(
        accountId: number,
        roles: user_role[]
    ): Promise<RecipientUser[]>;
    getUsersByIds(accountId: number, userIds: string[]): Promise<RecipientUser[]>;
    isDedupActive(dedupKey: string): Promise<boolean>;
}

function utcDateOnly(value: Date): Date {
    return new Date(
        Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
    );
}

function daysUntil(from: Date, to: Date): number {
    return Math.round(
        (utcDateOnly(to).getTime() - utcDateOnly(from).getTime()) /
            (24 * 60 * 60 * 1000)
    );
}

function buildReportUrl(reportType: string): string {
    return `/app/credit-dashboard/report?type=${reportType}`;
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
    const map = new Map<string, T>();
    rows.forEach((row) => map.set(row.id, row));
    return Array.from(map.values());
}

async function resolveRecipients(
    provider: NotificationRuleEvaluatorProvider,
    accountId: number,
    roleDefaults: user_role[],
    overrideUserIds: string[]
): Promise<string[]> {
    const [roleUsers, overrideUsers] = await Promise.all([
        provider.getUsersByRoles(accountId, roleDefaults),
        provider.getUsersByIds(accountId, overrideUserIds),
    ]);

    const fromRoles = roleUsers.filter((u) => u.active);

    const fromOverrides = overrideUsers.filter((u) => u.active);

    return uniqueById([...fromRoles, ...fromOverrides]).map((u) => u.id);
}

async function createIntentsForEntity(input: {
    provider: NotificationRuleEvaluatorProvider;
    accountId: number;
    recipients: string[];
    ruleSetId: number;
    ruleId: number;
    triggerType: TriggerType;
    entityType: "customer" | "invoice";
    entityId: string;
    title: string;
    message: string;
    actionUrl: string;
    metadata: Record<string, unknown>;
    priority?: "Normal" | "High";
    offsetDays?: number;
    skipIfAlreadyActive?: boolean;
}): Promise<NotificationDeliveryIntent[]> {
    const {
        provider,
        recipients,
        ruleSetId,
        ruleId,
        triggerType,
        entityType,
        entityId,
        title,
        message,
        actionUrl,
        metadata,
        priority = "Normal",
        offsetDays,
        skipIfAlreadyActive = true,
    } = input;

    const intents: NotificationDeliveryIntent[] = [];
    for (const recipientUserId of recipients) {
        for (const channel of ["in_app", "email"] as const) {
            const dedupKey = [
                "credit",
                triggerType,
                entityType,
                entityId,
                `recipient:${recipientUserId}`,
                `channel:${channel}`,
                offsetDays != null ? `offset:${offsetDays}` : null,
            ]
                .filter(Boolean)
                .join(":");

            if (skipIfAlreadyActive && (await provider.isDedupActive(dedupKey))) {
                continue;
            }

            intents.push({
                ruleSetId,
                ruleId,
                triggerType,
                recipientUserId,
                channel,
                dedupKey,
                title,
                message,
                actionUrl,
                metadata: { ...metadata, offsetDays: offsetDays ?? null },
                priority,
            });
        }
    }
    return intents;
}

export class PrismaNotificationRuleEvaluatorProvider
    implements NotificationRuleEvaluatorProvider
{
    constructor(
        private readonly prisma: PrismaClient,
        private readonly fetchUncoveredCustomerIds: (
            accountId: number
        ) => Promise<Set<number>>,
        private readonly options?: {
            isDedupActive?: (dedupKey: string) => Promise<boolean>;
        }
    ) {}

    async getRuleSets(accountId: number): Promise<RuleSetView[]> {
        const service = new NotificationRuleSetService(this.prisma);
        return service.getCreditRuleSets(accountId) as Promise<RuleSetView[]>;
    }

    async getOverdueBlockCustomers(accountId: number): Promise<CustomerSignal[]> {
        const rows = await this.prisma.customer.findMany({
            where: { account_id: accountId, overdue_block: true },
            select: { id: true, customer_number: true },
        });
        return rows.map((row) => ({
            customerId: row.id,
            customerNumber: row.customer_number,
        }));
    }

    async getCapacityGapCustomers(accountId: number): Promise<CustomerSignal[]> {
        const uncoveredIds = await this.fetchUncoveredCustomerIds(accountId);
        const rows = await this.prisma.customerPolicy.findMany({
            where: {
                Customer: { account_id: accountId },
                is_active: true,
                OR: [
                    { capacity_gap_amount: { gt: 0 } },
                    { uninsured_amount: { gt: 0 } },
                ],
            },
            select: {
                customer_id: true,
                Customer: { select: { customer_number: true } },
            },
        });
        const unique = new Map<number, CustomerSignal>();
        rows.forEach((row) => {
            if (uncoveredIds.has(row.customer_id)) {
                return;
            }
            unique.set(row.customer_id, {
                customerId: row.customer_id,
                customerNumber: row.Customer?.customer_number ?? null,
            });
        });
        return Array.from(unique.values());
    }

    async getLimitWarningCustomers(accountId: number): Promise<CustomerSignal[]> {
        const rows = await this.prisma.customer.findMany({
            where: { account_id: accountId, zero_limit_alert_exist: true },
            select: { id: true, customer_number: true },
        });
        return rows.map((row) => ({
            customerId: row.id,
            customerNumber: row.customer_number,
        }));
    }

    async getEntryTermsBreachInvoices(
        accountId: number
    ): Promise<InvoiceSignal[]> {
        const uncoveredIds = await this.fetchUncoveredCustomerIds(accountId);
        return this.prisma.invoice
            .findMany({
                where: {
                    account_id: accountId,
                    status: { in: ["Due", "Overdue"] },
                    amount: { gte: 0 },
                    OR: [
                        { ctv_payment_term: true },
                        { ctv_customer_overdue_mep: true },
                        { zero_limit_alert: true },
                        { reporting_breach: true },
                    ],
                },
                select: {
                    id: true,
                    customer_id: true,
                    invoice_number: true,
                    zero_limit_alert: true,
                },
            })
            .then((rows) =>
                rows
                    .filter(
                        (row) =>
                            row.customer_id == null ||
                            !uncoveredIds.has(row.customer_id)
                    )
                    .map((row) => ({
                        invoiceId: row.id,
                        customerId: row.customer_id,
                        invoiceNumber: row.invoice_number,
                        hasZeroLimitWarning: row.zero_limit_alert,
                    }))
            );
    }

    async getActionWindowInvoices(accountId: number): Promise<InvoiceSignal[]> {
        return this.prisma.invoice
            .findMany({
                where: actionWindowInvoiceWhere(accountId),
                select: {
                    id: true,
                    customer_id: true,
                    invoice_number: true,
                    target_reporting_date: true,
                    reporting_breach: true,
                },
            })
            .then((rows) =>
                rows.map((row) => ({
                    invoiceId: row.id,
                    customerId: row.customer_id,
                    invoiceNumber: row.invoice_number,
                    targetReportingDate: row.target_reporting_date,
                    reportingBreach: row.reporting_breach,
                }))
            );
    }

    async getUsersByRoles(
        accountId: number,
        roles: user_role[]
    ): Promise<RecipientUser[]> {
        const rows = await this.prisma.user.findMany({
            where: {
                account_id: accountId,
                role: { in: roles },
                deactivated_at: null,
            },
            select: { id: true, status: true },
        });
        return rows.map((row) => ({
            id: row.id,
            active: row.status === "Active",
        }));
    }

    async getUsersByIds(
        accountId: number,
        userIds: string[]
    ): Promise<RecipientUser[]> {
        if (userIds.length === 0) {
            return [];
        }
        const rows = await this.prisma.user.findMany({
            where: { account_id: accountId, id: { in: userIds } },
            select: {
                id: true,
                status: true,
                deactivated_at: true,
            },
        });
        return rows.map((row) => ({
            id: row.id,
            active: row.status === "Active" && row.deactivated_at == null,
        }));
    }

    async isDedupActive(dedupKey: string): Promise<boolean> {
        if (this.options?.isDedupActive) {
            return this.options.isDedupActive(dedupKey);
        }
        return false;
    }
}

export class NotificationRuleEvaluator {
    constructor(private readonly provider: NotificationRuleEvaluatorProvider) {}

    async evaluateCreditAccount(input: {
        accountId: number;
        now: Date;
    }): Promise<NotificationDeliveryIntent[]> {
        const ruleSets = await this.provider.getRuleSets(input.accountId);
        const enabledSets = ruleSets.filter(
            (set) => set.enabled && set.rules.length > 0
        );

        const allIntents: NotificationDeliveryIntent[] = [];
        for (const set of enabledSets) {
            const intents = await this.evaluateRuleSet({
                provider: this.provider,
                accountId: input.accountId,
                set,
                now: input.now,
                includeDedupFilter: true,
            });
            allIntents.push(...intents);
        }
        return allIntents;
    }

    async getActiveQualificationKeys(input: {
        accountId: number;
        now: Date;
        provider: NotificationRuleEvaluatorProvider;
    }): Promise<ActiveQualificationKey[]> {
        const { accountId, now, provider } = input;
        const ruleSets = await provider.getRuleSets(accountId);
        const keys: ActiveQualificationKey[] = [];

        for (const set of ruleSets) {
            if (!set.enabled || set.rules.length === 0) {
                continue;
            }
            const rule = set.rules[0];

            if (set.trigger_type === "overdue_block") {
                const customers = await provider.getOverdueBlockCustomers(
                    accountId
                );
                customers.forEach((customer) =>
                    keys.push({
                        ruleId: rule.id,
                        entityType: "customer",
                        entityId: String(customer.customerId),
                        offsetDays: null,
                    })
                );
            }

            if (set.trigger_type === "capacity_gap") {
                const customers = await provider.getCapacityGapCustomers(
                    accountId
                );
                customers.forEach((customer) =>
                    keys.push({
                        ruleId: rule.id,
                        entityType: "customer",
                        entityId: String(customer.customerId),
                        offsetDays: null,
                    })
                );
            }

            if (set.trigger_type === "limit_warnings") {
                const customers = await provider.getLimitWarningCustomers(
                    accountId
                );
                customers.forEach((customer) =>
                    keys.push({
                        ruleId: rule.id,
                        entityType: "customer",
                        entityId: String(customer.customerId),
                        offsetDays: null,
                    })
                );
            }

            if (set.trigger_type === "entry_terms_breach") {
                const invoices = await provider.getEntryTermsBreachInvoices(
                    accountId
                );
                invoices.forEach((invoice) =>
                    keys.push({
                        ruleId: rule.id,
                        entityType: "invoice",
                        entityId: String(invoice.invoiceId),
                        offsetDays: null,
                    })
                );
            }

            if (set.trigger_type === "action_window") {
                const invoices = await provider.getActionWindowInvoices(accountId);
                for (const invoice of invoices) {
                    if (!invoice.targetReportingDate) {
                        continue;
                    }
                    const dayDelta = daysUntil(now, invoice.targetReportingDate);
                    if (rule.advance_day_offsets.includes(dayDelta)) {
                        keys.push({
                            ruleId: rule.id,
                            entityType: "invoice",
                            entityId: String(invoice.invoiceId),
                            offsetDays: dayDelta,
                        });
                    }
                    if (invoice.reportingBreach) {
                        keys.push({
                            ruleId: rule.id,
                            entityType: "invoice",
                            entityId: String(invoice.invoiceId),
                            offsetDays: null,
                        });
                    }
                }
            }
        }

        return keys;
    }

    private async evaluateRuleSet(input: {
        provider: NotificationRuleEvaluatorProvider;
        accountId: number;
        set: RuleSetView;
        now: Date;
        includeDedupFilter: boolean;
    }): Promise<NotificationDeliveryIntent[]> {
        const { provider, accountId, set, now, includeDedupFilter } = input;
        const rule = set.rules[0];
        const recipients = await resolveRecipients(
            provider,
            accountId,
            rule.role_defaults,
            rule.user_overrides.map((r) => r.user_id)
        );
        if (recipients.length === 0) {
            return [];
        }

        const intents: NotificationDeliveryIntent[] = [];

        if (set.trigger_type === "overdue_block") {
            const customers = await provider.getOverdueBlockCustomers(accountId);
            for (const customer of customers) {
                intents.push(
                    ...(await createIntentsForEntity({
                        provider,
                        accountId,
                        recipients,
                        ruleSetId: set.id,
                        ruleId: rule.id,
                        triggerType: set.trigger_type,
                        entityType: "customer",
                        entityId: String(customer.customerId),
                        title: "Overdue block detected",
                        message: `Customer ${customer.customerNumber ?? customer.customerId} is in overdue block.`,
                        actionUrl: buildReportUrl("overdue"),
                        metadata: { customerId: customer.customerId },
                        priority: "High",
                        skipIfAlreadyActive: includeDedupFilter,
                    }))
                );
            }
        }

        if (set.trigger_type === "capacity_gap") {
            const customers = await provider.getCapacityGapCustomers(accountId);
            for (const customer of customers) {
                intents.push(
                    ...(await createIntentsForEntity({
                        provider,
                        accountId,
                        recipients,
                        ruleSetId: set.id,
                        ruleId: rule.id,
                        triggerType: set.trigger_type,
                        entityType: "customer",
                        entityId: String(customer.customerId),
                        title: "Capacity gap detected",
                        message: `Customer ${customer.customerNumber ?? customer.customerId} is above approved capacity.`,
                        actionUrl: buildReportUrl("capacity"),
                        metadata: { customerId: customer.customerId },
                        priority: "High",
                        skipIfAlreadyActive: includeDedupFilter,
                    }))
                );
            }
        }

        if (set.trigger_type === "limit_warnings") {
            const customers = await provider.getLimitWarningCustomers(accountId);
            for (const customer of customers) {
                intents.push(
                    ...(await createIntentsForEntity({
                        provider,
                        accountId,
                        recipients,
                        ruleSetId: set.id,
                        ruleId: rule.id,
                        triggerType: set.trigger_type,
                        entityType: "customer",
                        entityId: String(customer.customerId),
                        title: "Limit warning",
                        message: `Customer ${customer.customerNumber ?? customer.customerId} reached warning thresholds.`,
                        actionUrl: buildReportUrl("limit_warning"),
                        metadata: { customerId: customer.customerId },
                        skipIfAlreadyActive: includeDedupFilter,
                    }))
                );
            }
        }

        if (set.trigger_type === "entry_terms_breach") {
            const invoices = await provider.getEntryTermsBreachInvoices(accountId);
            for (const invoice of invoices) {
                const reportType = invoice.hasZeroLimitWarning
                    ? "zero_limit_warning"
                    : "terms";
                intents.push(
                    ...(await createIntentsForEntity({
                        provider,
                        accountId,
                        recipients,
                        ruleSetId: set.id,
                        ruleId: rule.id,
                        triggerType: set.trigger_type,
                        entityType: "invoice",
                        entityId: String(invoice.invoiceId),
                        title: "Entry or terms breach",
                        message: `Invoice ${invoice.invoiceNumber ?? invoice.invoiceId} breached entry/terms checks.`,
                        actionUrl: buildReportUrl(reportType),
                        metadata: {
                            invoiceId: invoice.invoiceId,
                            customerId: invoice.customerId,
                        },
                        priority: "High",
                        skipIfAlreadyActive: includeDedupFilter,
                    }))
                );
            }
        }

        if (set.trigger_type === "action_window") {
            const invoices = await provider.getActionWindowInvoices(accountId);
            for (const invoice of invoices) {
                if (!invoice.targetReportingDate) {
                    continue;
                }

                const dayDelta = daysUntil(now, invoice.targetReportingDate);
                if (rule.advance_day_offsets.includes(dayDelta)) {
                    intents.push(
                        ...(await createIntentsForEntity({
                            provider,
                            accountId,
                            recipients,
                            ruleSetId: set.id,
                            ruleId: rule.id,
                            triggerType: set.trigger_type,
                            entityType: "invoice",
                            entityId: String(invoice.invoiceId),
                            title: "Reporting deadline approaching",
                            message: `Invoice ${invoice.invoiceNumber ?? invoice.invoiceId} reaches reporting deadline in ${dayDelta} days.`,
                            actionUrl: buildReportUrl("reporting"),
                            metadata: {
                                invoiceId: invoice.invoiceId,
                                customerId: invoice.customerId,
                            },
                            offsetDays: dayDelta,
                            skipIfAlreadyActive: includeDedupFilter,
                        }))
                    );
                }

                if (invoice.reportingBreach) {
                    intents.push(
                        ...(await createIntentsForEntity({
                            provider,
                            accountId,
                            recipients,
                            ruleSetId: set.id,
                            ruleId: rule.id,
                            triggerType: set.trigger_type,
                            entityType: "invoice",
                            entityId: String(invoice.invoiceId),
                            title: "Reporting breach",
                            message: `Invoice ${invoice.invoiceNumber ?? invoice.invoiceId} missed reporting deadline.`,
                            actionUrl: buildReportUrl("reporting"),
                            metadata: {
                                invoiceId: invoice.invoiceId,
                                customerId: invoice.customerId,
                                reportingBreach: true,
                            },
                            priority: "High",
                            skipIfAlreadyActive: includeDedupFilter,
                        }))
                    );
                }
            }
        }

        return intents;
    }
}
