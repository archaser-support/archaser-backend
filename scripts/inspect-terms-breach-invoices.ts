/**
 * Inspect the terms-breach invoice set for one customer (read-only).
 *
 * Mirrors getCustomerTermsBreachCountByReason: open Due/Overdue invoices with
 * amount >= 0 and at least one breach flag.
 *
 * Usage:
 *   npx tsx scripts/inspect-terms-breach-invoices.ts --customer 4039
 *   npx tsx scripts/inspect-terms-breach-invoices.ts --customer 4039 --limit 3
 *   npx tsx scripts/inspect-terms-breach-invoices.ts --invoice SI260030239
 *   npx tsx scripts/inspect-terms-breach-invoices.ts --invoice SI260030239 --diagnose
 *   npx tsx scripts/inspect-terms-breach-invoices.ts --invoice SI260030239 --diagnose --fix
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    buildCreatedOverdueMepCauseColumns,
    isSameCreatedOverdueMepCauseColumns,
    loadInvoiceNumbersById,
    refreshCtvSnapshotsForInvoiceIds,
    resolveCreatedOverdueMepDetailsByInvoiceId,
    resolveMepBreachStartDate,
    toCauseDueDateYmd,
} from "@archaser/credit-insurance-domain";

const MEP_CAUSE_SELECT = {
    id: true,
    account_id: true,
    customer_id: true,
    invoice_number: true,
    status: true,
    invoice_date: true,
    amount: true,
    modified_at: true,
    ctv_customer_overdue_mep: true,
    ctv_customer_overdue_mep_cause_invoice_number: true,
    ctv_customer_overdue_mep_cause_due_date: true,
    ctv_customer_overdue_mep_cause_outstanding: true,
    ctv_customer_overdue_mep_days_past: true,
} as const;

function snapshotLogFields(invoice: {
    id: number;
    account_id: number | null;
    customer_id: number | null;
    invoice_number: string | null;
    status: string | null;
    invoice_date: Date | null;
    modified_at: Date | null;
    ctv_customer_overdue_mep: boolean;
    ctv_customer_overdue_mep_cause_invoice_number: string | null;
    ctv_customer_overdue_mep_cause_due_date: Date | null;
    ctv_customer_overdue_mep_cause_outstanding: number | null;
    ctv_customer_overdue_mep_days_past: number | null;
}) {
    return {
        invoiceId: invoice.id,
        accountId: invoice.account_id,
        customerId: invoice.customer_id,
        invoiceNumber: invoice.invoice_number,
        status: invoice.status,
        invoiceDate: invoice.invoice_date?.toISOString() ?? null,
        modifiedAt: invoice.modified_at?.toISOString() ?? null,
        ctvCustomerOverdueMep: invoice.ctv_customer_overdue_mep,
        causeInvoiceNumber:
            invoice.ctv_customer_overdue_mep_cause_invoice_number,
        causeDueDate: toCauseDueDateYmd(
            invoice.ctv_customer_overdue_mep_cause_due_date
        ),
        causeOutstanding: invoice.ctv_customer_overdue_mep_cause_outstanding,
        daysPastMep: invoice.ctv_customer_overdue_mep_days_past,
    };
}

async function inspectMepCauseSnapshot(
    prisma: PrismaClient,
    invoiceNumber: string
): Promise<void> {
    const invoices = await prisma.invoice.findMany({
        where: { invoice_number: invoiceNumber },
        select: MEP_CAUSE_SELECT,
    });
    if (invoices.length === 0) {
        console.log("[terms-breach] invoice not found:", { invoiceNumber });
    }
    for (const invoice of invoices) {
        console.log("[terms-breach] MEP cause snapshot:", snapshotLogFields(invoice));
    }
}

/**
 * Dry-run the MEP cause snapshot resolver against the stored row, then optionally
 * run {@link refreshCtvSnapshotsForInvoiceIds} (--fix) and re-read.
 */
async function diagnoseMepCauseSnapshot(
    prisma: PrismaClient,
    invoiceNumber: string,
    write: boolean
): Promise<void> {
    bindCreditInsurancePrisma(prisma);
    const invoices = await prisma.invoice.findMany({
        where: { invoice_number: invoiceNumber },
        select: MEP_CAUSE_SELECT,
    });
    if (invoices.length === 0) {
        console.log("[terms-breach] invoice not found:", { invoiceNumber });
        return;
    }

    for (const invoice of invoices) {
        console.log("[terms-breach] stored:", snapshotLogFields(invoice));

        if (invoice.account_id == null || invoice.customer_id == null) {
            console.log("[terms-breach] diagnose stop: missing account/customer", {
                invoiceId: invoice.id,
            });
            continue;
        }

        const policy = await prisma.customerPolicy.findFirst({
            where: { customer_id: invoice.customer_id, is_active: true },
            select: {
                max_allowed_mep: true,
                mep_cutoff_day: true,
                mep_substitute_extra_days: true,
            },
        });
        const mepBreachStartDate = await resolveMepBreachStartDate(
            invoice.account_id,
            prisma
        );
        console.log("[terms-breach] policy inputs:", {
            maxAllowedMep: policy?.max_allowed_mep ?? null,
            mepCutoffDay: policy?.mep_cutoff_day ?? null,
            mepSubstituteExtraDays: policy?.mep_substitute_extra_days ?? null,
            mepBreachStartDate: toCauseDueDateYmd(mepBreachStartDate),
        });

        const resolved = await resolveCreatedOverdueMepDetailsByInvoiceId({
            accountId: invoice.account_id,
            customerId: invoice.customer_id,
            invoices: [
                {
                    id: invoice.id,
                    invoice_date: invoice.invoice_date,
                    amount: invoice.amount,
                },
            ],
            maxAllowedMep: policy?.max_allowed_mep ?? null,
            mepBreachStartDate,
            monthEnd: {
                mepCutoffDay: policy?.mep_cutoff_day ?? null,
                mepSubstituteExtraDays:
                    policy?.mep_substitute_extra_days ?? null,
            },
            db: prisma,
        });
        const resolution = resolved.get(invoice.id);
        const causeNumbers = await loadInvoiceNumbersById(
            resolution?.causeInvoiceId != null
                ? [resolution.causeInvoiceId]
                : [],
            prisma
        );
        const nextColumns = buildCreatedOverdueMepCauseColumns(
            resolution?.flagged ?? false,
            resolution,
            causeNumbers
        );
        const storedColumns = {
            ctv_customer_overdue_mep_cause_invoice_number:
                invoice.ctv_customer_overdue_mep_cause_invoice_number,
            ctv_customer_overdue_mep_cause_due_date:
                invoice.ctv_customer_overdue_mep_cause_due_date,
            ctv_customer_overdue_mep_cause_outstanding:
                invoice.ctv_customer_overdue_mep_cause_outstanding,
            ctv_customer_overdue_mep_days_past:
                invoice.ctv_customer_overdue_mep_days_past,
        };
        const sameAsStored = isSameCreatedOverdueMepCauseColumns(
            nextColumns,
            storedColumns
        );

        console.log("[terms-breach] resolver would write:", {
            flagged: resolution?.flagged ?? false,
            causeInvoiceId: resolution?.causeInvoiceId ?? null,
            causeInvoiceNumber:
                nextColumns.ctv_customer_overdue_mep_cause_invoice_number,
            causeDueDate: toCauseDueDateYmd(
                nextColumns.ctv_customer_overdue_mep_cause_due_date
            ),
            causeOutstanding:
                nextColumns.ctv_customer_overdue_mep_cause_outstanding,
            daysPastMep: nextColumns.ctv_customer_overdue_mep_days_past,
            sameAsStored,
            verdict: sameAsStored
                ? "refresh would skip (unchanged)"
                : "refresh would update snapshot columns",
        });

        if (!write) {
            console.log(
                "[terms-breach] dry-run only; pass --fix to run refreshCtvSnapshotsForInvoiceIds"
            );
            continue;
        }

        const updatedCount = await refreshCtvSnapshotsForInvoiceIds(
            [invoice.id],
            prisma
        );
        const after = await prisma.invoice.findUnique({
            where: { id: invoice.id },
            select: MEP_CAUSE_SELECT,
        });
        console.log("[terms-breach] after refreshCtvSnapshotsForInvoiceIds:", {
            pendingWrites: updatedCount,
            stored: after ? snapshotLogFields(after) : null,
        });
    }
}

function parseArgs(argv: string[]): { customerId: number; limit: number } {
    const index = argv.indexOf("--customer");
    const customerId = Number(index === -1 ? NaN : argv[index + 1]);
    if (!Number.isInteger(customerId) || customerId <= 0) {
        throw new Error("--customer <id> is required");
    }
    const limitIndex = argv.indexOf("--limit");
    const limit = Number(limitIndex === -1 ? 1 : argv[limitIndex + 1]);
    return { customerId, limit: Number.isInteger(limit) && limit > 0 ? limit : 1 };
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const invoiceIndex = argv.indexOf("--invoice");
    if (invoiceIndex !== -1) {
        const invoiceNumber = argv[invoiceIndex + 1]?.trim();
        if (!invoiceNumber) {
            throw new Error("--invoice <invoice_number> needs a value");
        }
        const diagnose = argv.includes("--diagnose");
        const write = argv.includes("--fix");
        if (write && !diagnose) {
            throw new Error("--fix requires --diagnose");
        }
        const prisma = new PrismaClient();
        try {
            if (diagnose) {
                await diagnoseMepCauseSnapshot(prisma, invoiceNumber, write);
            } else {
                await inspectMepCauseSnapshot(prisma, invoiceNumber);
            }
        } finally {
            await prisma.$disconnect();
        }
        return;
    }

    const { customerId, limit } = parseArgs(argv);
    const prisma = new PrismaClient();

    try {
        const customer = await prisma.customer.findUnique({
            where: { id: customerId },
            select: { id: true, account_id: true, customer_number: true },
        });
        if (!customer) {
            throw new Error(`customer ${customerId} not found`);
        }

        const where = {
            account_id: customer.account_id,
            customer_id: customerId,
            status: { in: ["Due", "Overdue"] },
            amount: { gte: 0 },
            OR: [
                { reporting_breach: true },
                { ctv_payment_term: true },
                { ctv_customer_overdue_mep: true },
                { ctv_outdated_dcl: true },
                { ctv_invoice_after_policy_end: true },
            ],
        } as const;

        const total = await prisma.invoice.count({ where });
        console.log("[terms-breach] customer:", {
            customerId: customer.id,
            accountId: customer.account_id,
            customerNumber: customer.customer_number,
            breachInvoiceCount: total,
        });

        if (total === 0) {
            const openCount = await prisma.invoice.count({
                where: {
                    account_id: customer.account_id,
                    customer_id: customerId,
                    status: { in: ["Due", "Overdue"] },
                },
            });
            const policies = await prisma.customerPolicy.findMany({
                where: { customer_id: customerId },
                select: {
                    insurance_policy_id: true,
                    is_active: true,
                    excluded_from_policy: true,
                    policy_exclusion_reason: true,
                    outdated_dcl: true,
                },
            });
            console.log("[terms-breach] no flagged invoices:", {
                openDueOverdueCount: openCount,
                policyRows: JSON.stringify(policies),
            });
        }

        const invoices = await prisma.invoice.findMany({
            where,
            orderBy: { invoice_date: "asc" },
            take: limit,
            select: {
                id: true,
                invoice_number: true,
                status: true,
                invoice_date: true,
                due_date: true,
                amount: true,
                outstanding_debt: true,
                customer_outstanding_debt: true,
                customer_currency: true,
                policy_id: true,
                payment_term: true,
                in_capacity_gap: true,
                capacity_gap_amount: true,
                reported_status: true,
                actual_reporting_date: true,
                reporting_breach: true,
                target_reporting_date: true,
                target_mep_date: true,
                ctv_payment_term: true,
                ctv_customer_overdue_mep: true,
                ctv_outdated_dcl: true,
                ctv_invoice_after_policy_end: true,
            },
        });

        for (const invoice of invoices) {
            console.log("[terms-breach] sample invoice:", {
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoice_number,
                status: invoice.status,
                invoiceDate: invoice.invoice_date?.toISOString() ?? null,
                dueDate: invoice.due_date?.toISOString() ?? null,
                amount: String(invoice.amount),
                outstandingDebt: String(invoice.outstanding_debt),
                customerOutstandingDebt: String(invoice.customer_outstanding_debt),
                customerCurrency: invoice.customer_currency,
                policyId: invoice.policy_id,
                paymentTerm: invoice.payment_term,
                inCapacityGap: invoice.in_capacity_gap,
                capacityGapAmount: String(invoice.capacity_gap_amount),
                reportedStatus: invoice.reported_status,
                actualReportingDate:
                    invoice.actual_reporting_date?.toISOString() ?? null,
                reportingBreach: invoice.reporting_breach,
                targetReportingDate:
                    invoice.target_reporting_date?.toISOString() ?? null,
                targetMepDate: invoice.target_mep_date?.toISOString() ?? null,
                ctvPaymentTerm: invoice.ctv_payment_term,
                ctvCustomerOverdueMep: invoice.ctv_customer_overdue_mep,
                ctvOutdatedDcl: invoice.ctv_outdated_dcl,
                ctvInvoiceAfterPolicyEnd: invoice.ctv_invoice_after_policy_end,
            });
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error("[terms-breach] failed:", error);
    process.exit(1);
});
