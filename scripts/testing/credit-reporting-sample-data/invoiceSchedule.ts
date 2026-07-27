import {
    CUSTOMER_NUMBER_PREFIX,
    DEFAULT_INVOICES_TOTAL,
    DEFAULT_WINDOW_DAYS,
    PARTIAL_PAYMENT_INVOICE_PCT,
    POLICY_PADDING_DAYS,
} from "./constants";
import type {
    HistoryWindow,
    InvoiceScheduleBreakdown,
    ScheduledCustomer,
    ScheduledInvoice,
    ScheduledPayment,
    ScriptConfig,
} from "./types";
import { addUtcDaysTo, formatUtcDate } from "./window";

function distributeCount(total: number, buckets: number): number[] {
    const base = Math.floor(total / buckets);
    const remainder = total % buckets;
    return Array.from({ length: buckets }, (_, index) =>
        index < remainder ? base + 1 : base
    );
}

/** All open invoices for a customer share the policy / profile currency. */
function resolveInvoiceCurrency(customer: ScheduledCustomer): "ILS" | "USD" {
    return customer.approvedLimitCurrency;
}

function resolveCustomerAmount(
    customer: ScheduledCustomer,
    invoiceSlot: number
): number {
    const currency = resolveInvoiceCurrency(customer);
    const limit = customer.approvedLimit;

    switch (customer.scenario) {
        case "gap":
            return currency === "USD"
                ? 8_000 + (invoiceSlot % 4) * 2_500
                : 25_000 + (invoiceSlot % 4) * 10_000;
        case "zero-limit":
        case "excluded":
            return currency === "USD"
                ? 500 + invoiceSlot * 100
                : 2_000 + invoiceSlot * 500;
        case "no-policy":
            return currency === "USD"
                ? 3_000 + invoiceSlot * 750
                : 12_000 + invoiceSlot * 3_000;
        default:
            if (limit <= 0) {
                return currency === "USD" ? 1_000 : 4_000;
            }
            const fraction = 0.04 + (invoiceSlot % 5) * 0.02;
            const raw = Math.max(
                currency === "USD" ? 500 : 2_000,
                Math.round(limit * fraction)
            );
            return raw;
    }
}

function resolveInvoiceDates(
    customer: ScheduledCustomer,
    openDayIndex: number,
    invoiceSlot: number,
    windowDays: number
): { invoiceDateDayIndex: number; dueDateDayIndex: number; paymentTermDays: number } {
    const policyEndDayIndex = windowDays - 1 + POLICY_PADDING_DAYS;

    switch (customer.scenario) {
        case "breach-mep": {
            const invoiceDateDayIndex = Math.max(0, openDayIndex - 45);
            const paymentTermDays = 90;
            const dueDateDayIndex = Math.max(0, openDayIndex - 10);
            return { invoiceDateDayIndex, dueDateDayIndex, paymentTermDays };
        }
        case "breach-reporting": {
            const invoiceDateDayIndex = Math.max(0, openDayIndex - 60);
            const paymentTermDays = 30;
            const dueDateDayIndex = invoiceDateDayIndex + paymentTermDays;
            return { invoiceDateDayIndex, dueDateDayIndex, paymentTermDays };
        }
        case "breach-outdated-dcl": {
            const paymentTermDays = 45;
            return {
                invoiceDateDayIndex: openDayIndex,
                dueDateDayIndex: openDayIndex + paymentTermDays,
                paymentTermDays,
            };
        }
        case "breach-post-policy-end": {
            const invoiceDateDayIndex = policyEndDayIndex;
            const paymentTermDays = 30;
            return {
                invoiceDateDayIndex,
                dueDateDayIndex: invoiceDateDayIndex + paymentTermDays,
                paymentTermDays,
            };
        }
        default: {
            const paymentTermDays = 30 + (invoiceSlot % 3) * 15;
            return {
                invoiceDateDayIndex: openDayIndex,
                dueDateDayIndex: openDayIndex + paymentTermDays,
                paymentTermDays,
            };
        }
    }
}

function resolveOpenDayIndex(
    customer: ScheduledCustomer,
    invoiceSlot: number,
    invoicesForCustomer: number,
    windowDays: number
): number {
    const earliest = customer.dayIndex - 1;
    const span = Math.max(1, windowDays - earliest);
    const slot = invoiceSlot + 1;
    const offset = Math.floor((span * slot) / (invoicesForCustomer + 1));
    return Math.min(windowDays - 1, earliest + offset);
}

export function resolveTargetInvoiceCount(config: ScriptConfig): number {
    const scale = config.days / DEFAULT_WINDOW_DAYS;
    return Math.max(1, Math.round(DEFAULT_INVOICES_TOTAL * scale));
}

export function buildInvoiceSchedule(args: {
    config: ScriptConfig;
    window: HistoryWindow;
    customers: ScheduledCustomer[];
}): {
    invoices: ScheduledInvoice[];
    invoicesByDay: Map<string, ScheduledInvoice[]>;
    paymentsByDay: Map<string, ScheduledPayment[]>;
    breakdown: InvoiceScheduleBreakdown;
    targetInvoiceCount: number;
} {
    const targetInvoiceCount = resolveTargetInvoiceCount(args.config);
    const perCustomerCounts = distributeCount(
        targetInvoiceCount,
        Math.max(1, args.customers.length)
    );

    const invoices: ScheduledInvoice[] = [];
    const invoicesByDay = new Map<string, ScheduledInvoice[]>();
    const paymentsByDay = new Map<string, ScheduledPayment[]>();
    const breakdown: InvoiceScheduleBreakdown = {
        total: 0,
        withPartialPayment: 0,
        ilsCurrency: 0,
        usdCurrency: 0,
    };

    const partialPaymentEvery = Math.max(
        1,
        Math.round(100 / PARTIAL_PAYMENT_INVOICE_PCT)
    );

    for (const customer of args.customers) {
        const invoicesForCustomer = perCustomerCounts[customer.index] ?? 0;
        if (invoicesForCustomer <= 0) {
            continue;
        }

        for (let slot = 0; slot < invoicesForCustomer; slot++) {
            const openDayIndex = resolveOpenDayIndex(
                customer,
                slot,
                invoicesForCustomer,
                args.window.windowDays
            );
            const dates = resolveInvoiceDates(
                customer,
                openDayIndex,
                slot,
                args.window.windowDays
            );
            const invoiceCurrency = resolveInvoiceCurrency(customer);
            const customerAmount = resolveCustomerAmount(customer, slot);
            const invoiceNumber = `${CUSTOMER_NUMBER_PREFIX}-INV-${String(customer.index + 1).padStart(3, "0")}-${String(slot + 1).padStart(2, "0")}`;

            const scheduled: ScheduledInvoice = {
                customerIndex: customer.index,
                invoiceSlot: slot,
                invoiceNumber,
                openDayIndex,
                invoiceDateDayIndex: dates.invoiceDateDayIndex,
                dueDateDayIndex: dates.dueDateDayIndex,
                customerAmount,
                invoiceCurrency,
                paymentTermDays: dates.paymentTermDays,
            };

            const schedulePartial =
                slot % partialPaymentEvery === 0 &&
                customer.scenario !== "zero-limit";
            if (schedulePartial) {
                const paymentDayIndex = Math.min(
                    args.window.windowDays - 1,
                    openDayIndex + 7 + (slot % 5) * 5
                );
                scheduled.partialPaymentFraction = 0.3 + (slot % 4) * 0.1;
                scheduled.paymentDayIndex = paymentDayIndex;

                const payment: ScheduledPayment = {
                    customerIndex: customer.index,
                    invoiceNumber,
                    paymentDayIndex,
                    customerAmount:
                        customerAmount * scheduled.partialPaymentFraction,
                    invoiceCurrency,
                };
                const paymentDayKey = formatUtcDate(
                    addUtcDaysTo(args.window.windowStart, paymentDayIndex)
                );
                const dayPayments = paymentsByDay.get(paymentDayKey) ?? [];
                dayPayments.push(payment);
                paymentsByDay.set(paymentDayKey, dayPayments);
                breakdown.withPartialPayment += 1;
            }

            const openDayKey = formatUtcDate(
                addUtcDaysTo(args.window.windowStart, openDayIndex)
            );
            const dayInvoices = invoicesByDay.get(openDayKey) ?? [];
            dayInvoices.push(scheduled);
            invoicesByDay.set(openDayKey, dayInvoices);
            invoices.push(scheduled);
            breakdown.total += 1;
            if (invoiceCurrency === "ILS") {
                breakdown.ilsCurrency += 1;
            } else {
                breakdown.usdCurrency += 1;
            }
        }
    }

    return {
        invoices,
        invoicesByDay,
        paymentsByDay,
        breakdown,
        targetInvoiceCount,
    };
}

export function formatInvoiceBreakdown(
    breakdown: InvoiceScheduleBreakdown
): string[] {
    return [
        `  invoices scheduled: ${breakdown.total}`,
        `  partial-payment invoices: ${breakdown.withPartialPayment}`,
        `  currency mix: ILS=${breakdown.ilsCurrency}, USD=${breakdown.usdCurrency}`,
    ];
}
