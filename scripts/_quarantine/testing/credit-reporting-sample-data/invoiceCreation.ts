import type { invoice_status } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { CustomerService } from "@/server/services/CustomerService";
import { stampInvoiceInsuranceFieldsAsOf } from "@/server/services/creditInsurance/stampInvoiceInsuranceFieldsAsOf";

import {
    convertCustomerAmountToAccountCurrency,
    upsertFxRateForDay,
} from "./fxRates";
import { ACCOUNT_CURRENCY } from "./constants";
import { restampLimitAssessmentForCustomers } from "./limitAssessment";
import type {
    AccountBootstrapResult,
    HistoryWindow,
    ScheduledCustomer,
    ScheduledInvoice,
    ScheduledPayment,
} from "./types";
import { addUtcDaysTo } from "./window";

export type InvoiceCreationResult = {
    invoiceId: number;
    invoiceNumber: string;
    customerId: number;
};

export type PaymentCreationResult = {
    invoiceId: number;
    customerId: number;
    paymentId: number;
};
function resolveOpenStatus(
    dueDate: Date,
    asOfDay: Date
): invoice_status {
    const dueMs = Date.UTC(
        dueDate.getUTCFullYear(),
        dueDate.getUTCMonth(),
        dueDate.getUTCDate()
    );
    const asOfMs = Date.UTC(
        asOfDay.getUTCFullYear(),
        asOfDay.getUTCMonth(),
        asOfDay.getUTCDate()
    );
    return dueMs < asOfMs ? "Overdue" : "Due";
}

export async function createScheduledInvoicesForDay(args: {
    scheduledInvoices: ScheduledInvoice[];
    customerIdByIndex: Map<number, number>;
    customersByIndex: Map<number, ScheduledCustomer>;
    bootstrap: AccountBootstrapResult;
    window: HistoryWindow;
    day: Date;
    dayOffset: number;
    actorUserId: string;
}): Promise<InvoiceCreationResult[]> {
    if (args.scheduledInvoices.length === 0) {
        return [];
    }

    const usdToIls = await upsertFxRateForDay({
        rateDate: args.day,
        dayOffset: args.dayOffset,
    });

    const results: InvoiceCreationResult[] = [];

    for (const scheduled of args.scheduledInvoices) {
        const customerId = args.customerIdByIndex.get(scheduled.customerIndex);
        if (!customerId) {
            continue;
        }

        const invoiceDate = addUtcDaysTo(
            args.window.windowStart,
            scheduled.invoiceDateDayIndex
        );
        const dueDate = addUtcDaysTo(
            args.window.windowStart,
            scheduled.dueDateDayIndex
        );
        const customerAmount = scheduled.customerAmount;
        const accountAmount = convertCustomerAmountToAccountCurrency({
            customerAmount,
            invoiceCurrency: scheduled.invoiceCurrency,
            usdToIls,
        });
        const status = resolveOpenStatus(dueDate, args.day);
        const now = args.day;
        const policyId = args.bootstrap.primaryPolicyId;

        const invoice = await prisma.invoice.create({
            data: {
                account_id: args.bootstrap.accountId,
                customer_id: customerId,
                policy_id: policyId,
                invoice_number: scheduled.invoiceNumber,
                invoice_date: invoiceDate,
                due_date: dueDate,
                payment_term: scheduled.paymentTermDays,
                amount: accountAmount,
                net_amount: accountAmount,
                customer_amount: customerAmount,
                customer_net_amount: customerAmount,
                outstanding_debt: accountAmount,
                customer_outstanding_debt: customerAmount,
                total_paid: 0,
                customer_total_paid: 0,
                customer_currency: scheduled.invoiceCurrency,
                status,
                created_at: now,
                modified_at: now,
                created_by: args.actorUserId,
                modified_by: args.actorUserId,
            },
            select: {
                id: true,
                invoice_number: true,
            },
        });

        await stampInvoiceInsuranceFieldsAsOf(invoice.id, args.day);

        results.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoice_number ?? scheduled.invoiceNumber,
            customerId,
        });
    }

    const affectedCustomerIds = [
        ...new Set(results.map((result) => result.customerId)),
    ];
    if (affectedCustomerIds.length > 0) {
        await restampLimitAssessmentForCustomers(
            affectedCustomerIds,
            ACCOUNT_CURRENCY
        );
        await CustomerService.recalculateAllAmountsForCustomers(
            affectedCustomerIds
        );
    }

    return results;
}

export async function createScheduledPaymentsForDay(args: {
    scheduledPayments: ScheduledPayment[];
    customerIdByIndex: Map<number, number>;
    invoiceIdByNumber: Map<string, number>;
    bootstrap: AccountBootstrapResult;
    window: HistoryWindow;
    day: Date;
    dayOffset: number;
    actorUserId: string;
}): Promise<PaymentCreationResult[]> {
    if (args.scheduledPayments.length === 0) {
        return [];
    }

    const usdToIls = await upsertFxRateForDay({
        rateDate: args.day,
        dayOffset: args.dayOffset,
    });

    const results: PaymentCreationResult[] = [];

    for (const scheduled of args.scheduledPayments) {
        const customerId = args.customerIdByIndex.get(scheduled.customerIndex);
        const invoiceId = args.invoiceIdByNumber.get(scheduled.invoiceNumber);
        if (!customerId || !invoiceId) {
            continue;
        }

        const customerAmount = scheduled.customerAmount;
        const accountAmount = convertCustomerAmountToAccountCurrency({
            customerAmount,
            invoiceCurrency: scheduled.invoiceCurrency,
            usdToIls,
        });

        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
            select: { invoice_number: true },
        });
        const invoicePayment = await prisma.invoicePayment.create({
            data: {
                invoice_id: invoiceId,
                customer_id: customerId,
                account_id: args.bootstrap.accountId,
                amount: accountAmount,
                customer_amount: customerAmount,
                customer_currency: scheduled.invoiceCurrency,
                payment_date: args.day,
                payment_method: "Bank Transfer",
                reference: `CRD-RPT-PAY-${scheduled.invoiceNumber}`,
                invoice_number: invoice?.invoice_number ?? scheduled.invoiceNumber,
            },
        });

        await stampInvoiceInsuranceFieldsAsOf(invoiceId, args.day);

        results.push({
            invoiceId,
            customerId,
            paymentId: invoicePayment.id,
        });    }

    const affectedCustomerIds = [
        ...new Set(results.map((result) => result.customerId)),
    ];
    if (affectedCustomerIds.length > 0) {
        await restampLimitAssessmentForCustomers(
            affectedCustomerIds,
            ACCOUNT_CURRENCY
        );
        await CustomerService.recalculateAllAmountsForCustomers(
            affectedCustomerIds
        );
    }

    return results;
}

export async function loadInvoiceIdByNumber(
    accountId: number
): Promise<Map<string, number>> {
    const invoices = await prisma.invoice.findMany({
        where: {
            account_id: accountId,
            invoice_number: { startsWith: "CRD-RPT-INV-" },
        },
        select: {
            id: true,
            invoice_number: true,
        },
    });

    const invoiceIdByNumber = new Map<string, number>();
    for (const invoice of invoices) {
        if (invoice.invoice_number) {
            invoiceIdByNumber.set(invoice.invoice_number, invoice.id);
        }
    }
    return invoiceIdByNumber;
}
