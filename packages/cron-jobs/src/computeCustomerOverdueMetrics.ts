import { Prisma, activity_status, type PrismaClient } from "@prisma/client";
import { bindCreditDomain, requireCreditDomainModule } from "./creditDomain";

const CUSTOMER_CHUNK = 2000;
const INVOICE_REPORTING_BREACH_CHUNK = 2000;

function startOfTodayUtc(): Date {
    const n = new Date();
    return new Date(
        Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())
    );
}

function scheduleTimeOnApprovedLimitExpirationDate(expiration: Date): Date {
    return new Date(
        Date.UTC(
            expiration.getUTCFullYear(),
            expiration.getUTCMonth(),
            expiration.getUTCDate(),
            12,
            0,
            0,
            0
        )
    );
}

/**
 * Daily job:
 * - Customer: sync oldest_invoice_overdue_date + overdue_block for credit-insurance customers.
 * - Approved-limit expiration: reset approved_limit once expiration date is in the past.
 * - Insurance policy status maintenance.
 */
export async function computeCustomerOverdueMetrics(
    prisma: PrismaClient,
    customerIdFilter?: number
): Promise<{
    success: boolean;
    message: string;
    summary: {
        customersSynced: number;
        reportingBreachesPromoted: number;
        limitExpirationsProcessed: number;
        policiesDeactivated: number;
        policiesPrematureDeactivated: number;
        policiesActivated: number;
        topUpsDeactivated: number;
        topUpsActivated: number;
        iterations: number;
    };
    durationMs: number;
}> {
    const start = Date.now();
    bindCreditDomain(prisma);

    const syncMod = requireCreditDomainModule<{
        syncCustomerInsuranceFields: (customerId: number) => Promise<unknown>;
    }>("domain/syncCustomerInsuranceFields.js");
    const breachMod = requireCreditDomainModule<{
        sweepReportingBreachForOverdueInvoiceIds: (
            invoiceIds: number[],
            db?: PrismaClient
        ) => Promise<number>;
    }>("domain/syncInvoiceReportingBreach.js");
    const statusMod = requireCreditDomainModule<{
        runInsurancePolicyStatusMaintenance: () => Promise<{
            policiesDeactivated: number;
            policiesPrematureDeactivated: number;
            policiesActivated: number;
            topUpsDeactivated: number;
            topUpsActivated: number;
        }>;
    }>("domain/insurancePolicyStatusCron.js");

    let customersSynced = 0;
    let limitExpirationsProcessed = 0;
    let reportingBreachesPromoted = 0;
    let lastCustomerId = 0;
    let iteration = 0;

    for (;;) {
        iteration += 1;
        const chunk = await prisma.customer.findMany({
            where: {
                id: { gt: lastCustomerId },
                Account: { has_credit_insurance: true },
                ...(typeof customerIdFilter === "number"
                    ? { id: customerIdFilter }
                    : {}),
            },
            select: { id: true },
            orderBy: { id: "asc" },
            take: CUSTOMER_CHUNK,
        });

        if (chunk.length === 0) {
            break;
        }

        const lastId = chunk[chunk.length - 1]!.id;
        if (lastId <= lastCustomerId) {
            break;
        }
        lastCustomerId = lastId;

        for (const row of chunk) {
            await syncMod.syncCustomerInsuranceFields(row.id);
            customersSynced += 1;
        }
    }

    let lastInvoiceId = 0;
    for (;;) {
        const invoiceBatch = await prisma.invoice.findMany({
            where: {
                id: { gt: lastInvoiceId },
                status: { in: ["Due", "Overdue"] },
                actual_reporting_date: null,
                target_reporting_date: { not: null },
                reporting_breach: false,
                OR: [{ amount: null }, { amount: { gte: 0 } }],
                Customer: {
                    Account: { has_credit_insurance: true },
                },
                ...(typeof customerIdFilter === "number"
                    ? { customer_id: customerIdFilter }
                    : {}),
            },
            select: { id: true },
            orderBy: { id: "asc" },
            take: INVOICE_REPORTING_BREACH_CHUNK,
        });

        if (invoiceBatch.length === 0) {
            break;
        }

        const lastId = invoiceBatch[invoiceBatch.length - 1]!.id;
        if (lastId <= lastInvoiceId) {
            break;
        }
        lastInvoiceId = lastId;

        reportingBreachesPromoted +=
            await breachMod.sweepReportingBreachForOverdueInvoiceIds(
                invoiceBatch.map((row) => row.id),
                prisma
            );
    }

    const todayUtc = startOfTodayUtc();
    const expiredFromActivePolicy = await prisma.customerPolicy.findMany({
        where: {
            is_active: true,
            ...(typeof customerIdFilter === "number"
                ? { customer_id: customerIdFilter }
                : {}),
            Customer: {
                Account: { has_credit_insurance: true },
            },
            approved_limit_expiration_date: {
                not: null,
                lt: todayUtc,
            },
            approved_limit: {
                not: null,
                gt: new Prisma.Decimal(0),
            },
        },
        select: {
            id: true,
            customer_id: true,
            approved_limit_expiration_date: true,
            Customer: {
                select: { account_id: true },
            },
        },
    });

    for (const c of expiredFromActivePolicy) {
        const expiration = c.approved_limit_expiration_date;
        if (!expiration) {
            continue;
        }
        const activityOnExpirationDay =
            scheduleTimeOnApprovedLimitExpirationDate(
                expiration instanceof Date ? expiration : new Date(expiration)
            );

        await prisma.customerPolicy.update({
            where: { id: c.id },
            data: { approved_limit: new Prisma.Decimal(0) },
        });

        await prisma.activity.create({
            data: {
                customer_id: c.customer_id,
                account_id: c.Customer.account_id,
                type: "Internal",
                status: activity_status.COMPLETED,
                system_generated: true,
                content: "",
                title: "{{activities.fields.activity_approved_limit_expired_reset_on_date}}",
                schedule_time: activityOnExpirationDay,
                actual_delivery_time: activityOnExpirationDay,
                title_params: {
                    date: activityOnExpirationDay.toISOString(),
                },
            },
        });

        limitExpirationsProcessed += 1;
    }

    const policyStatus = await statusMod.runInsurancePolicyStatusMaintenance();
    const durationMs = Date.now() - start;
    const summary = {
        customersSynced,
        reportingBreachesPromoted,
        limitExpirationsProcessed,
        ...policyStatus,
        iterations: iteration,
    };

    return {
        success: true,
        message: "computeCustomerOverdueMetrics completed",
        summary,
        durationMs,
    };
}
