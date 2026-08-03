import type { PrismaClient, user_role } from "@prisma/client";
import type { ActiveQualificationKey } from "./NotificationDeliveryLogService";
type TriggerType = "overdue_block" | "capacity_gap" | "entry_terms_breach" | "action_window" | "limit_warnings";
type RuleSetView = {
    id: number;
    trigger_type: TriggerType;
    enabled: boolean;
    rules: Array<{
        id: number;
        advance_day_offsets: number[];
        role_defaults: user_role[];
        user_overrides: Array<{
            user_id: string;
        }>;
    }>;
};
type RecipientUser = {
    id: string;
    active: boolean;
};
type CustomerSignal = {
    customerId: number;
    customerNumber?: string | null;
};
type InvoiceSignal = {
    invoiceId: number;
    customerId: number | null;
    invoiceNumber?: string | null;
    targetReportingDate?: Date | null;
    reportingBreach?: boolean;
    hasZeroLimitWarning?: boolean;
};
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
    getUsersByRoles(accountId: number, roles: user_role[]): Promise<RecipientUser[]>;
    getUsersByIds(accountId: number, userIds: string[]): Promise<RecipientUser[]>;
    isDedupActive(dedupKey: string): Promise<boolean>;
}
export declare class PrismaNotificationRuleEvaluatorProvider implements NotificationRuleEvaluatorProvider {
    private readonly prisma;
    private readonly fetchUncoveredCustomerIds;
    private readonly options?;
    constructor(prisma: PrismaClient, fetchUncoveredCustomerIds: (accountId: number) => Promise<Set<number>>, options?: {
        isDedupActive?: (dedupKey: string) => Promise<boolean>;
    } | undefined);
    getRuleSets(accountId: number): Promise<RuleSetView[]>;
    getOverdueBlockCustomers(accountId: number): Promise<CustomerSignal[]>;
    getCapacityGapCustomers(accountId: number): Promise<CustomerSignal[]>;
    getLimitWarningCustomers(accountId: number): Promise<CustomerSignal[]>;
    getEntryTermsBreachInvoices(accountId: number): Promise<InvoiceSignal[]>;
    getActionWindowInvoices(accountId: number): Promise<InvoiceSignal[]>;
    getUsersByRoles(accountId: number, roles: user_role[]): Promise<RecipientUser[]>;
    getUsersByIds(accountId: number, userIds: string[]): Promise<RecipientUser[]>;
    isDedupActive(dedupKey: string): Promise<boolean>;
}
export declare class NotificationRuleEvaluator {
    private readonly provider;
    constructor(provider: NotificationRuleEvaluatorProvider);
    evaluateCreditAccount(input: {
        accountId: number;
        now: Date;
    }): Promise<NotificationDeliveryIntent[]>;
    getActiveQualificationKeys(input: {
        accountId: number;
        now: Date;
        provider: NotificationRuleEvaluatorProvider;
    }): Promise<ActiveQualificationKey[]>;
    private evaluateRuleSet;
}
export {};
