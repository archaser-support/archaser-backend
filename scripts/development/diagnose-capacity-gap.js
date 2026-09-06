/**
 * Read-only diagnosis of why a customer's capacity gap is 0.
 *
 * Usage: node scripts/development/diagnose-capacity-gap.js <customerId>
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function toCsvValue(value) {
    if (value == null) {
        return '';
    }
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeGapInvoicesCsv(customerId, gapInvoices) {
    const columns = [
        'invoice_id',
        'invoice_number',
        'status',
        'invoice_date',
        'due_date',
        'customer_currency',
        'outstanding_debt',
        'customer_outstanding_debt',
        'policy_id',
        'in_capacity_gap',
        'limit_assessed_amount',
        'limit_assessed_currency',
        'limit_assessed_at',
        'capacity_gap_amount',
        'capacity_gap_amount_limit',
        'capacity_gap_amount_date',
    ];

    const rows = gapInvoices.map((inv) => [
        inv.id,
        inv.invoice_number,
        inv.status,
        inv.invoice_date,
        inv.due_date,
        inv.customer_currency,
        inv.outstanding_debt,
        inv.customer_outstanding_debt,
        inv.policy_id,
        inv.in_capacity_gap,
        inv.limit_assessed_amount,
        inv.limit_assessed_currency,
        inv.limit_assessed_at,
        inv.capacity_gap_amount,
        inv.capacity_gap_amount_limit,
        inv.capacity_gap_amount_date,
    ]);

    const outputPath = path.resolve(
        __dirname,
        '../../.scratch',
        `capacity-gap-invoices-${customerId}.csv`
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
        outputPath,
        [columns.join(','), ...rows.map((r) => r.map(toCsvValue).join(','))].join('\n') + '\n',
        'utf8'
    );
    return outputPath;
}

async function main() {
    const customerId = Number(process.argv[2] || 4036);

    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            account_id: true,
            customer_number: true,
            total_due_amount: true,
            total_overdue_amount: true,
            zero_limit_alert_exist: true,
        },
    });

    if (!customer) {
        console.log('[diagnose] Customer not found:', { customerId });
        return;
    }

    const account = await prisma.account.findUnique({
        where: { id: customer.account_id },
        select: { id: true, name: true, has_credit_insurance: true, currency: true },
    });

    console.log('[diagnose] Customer:', {
        customerId: customer.id,
        customerNumber: customer.customer_number,
        accountId: customer.account_id,
        accountName: account?.name,
        accountCurrency: account?.currency,
        accountHasCreditInsurance: account?.has_credit_insurance,
        totalDueAmount: customer.total_due_amount,
        totalOverdueAmount: customer.total_overdue_amount,
        zeroLimitAlertExist: customer.zero_limit_alert_exist,
    });

    const policies = await prisma.customerPolicy.findMany({
        where: { customer_id: customerId },
        orderBy: [{ is_active: 'desc' }, { modified_at: 'desc' }],
        select: {
            id: true,
            is_active: true,
            insurance_policy_id: true,
            approved_limit: true,
            approved_limit_currency: true,
            approved_limit_expiration_date: true,
            excluded_from_policy: true,
            policy_exclusion_reason: true,
            outdated_dcl: true,
            capacity_gap_amount: true,
            capacity_gap_amount1: true,
            capacity_gap_currency1: true,
            capacity_gap_amount_date: true,
            retained_capacity_gap: true,
            uninsured_amount: true,
            modified_at: true,
        },
    });

    console.log('[diagnose] CustomerPolicy rows:', policies.length);
    policies.forEach((p, i) => {
        console.log(`[diagnose] policy${i}:`, {
            policyRowId: p.id,
            isActive: p.is_active,
            insurancePolicyId: p.insurance_policy_id,
            approvedLimit: p.approved_limit ? String(p.approved_limit) : null,
            approvedLimitCurrency: p.approved_limit_currency,
            approvedLimitExpiration: p.approved_limit_expiration_date,
            excludedFromPolicy: p.excluded_from_policy,
            policyExclusionReason: p.policy_exclusion_reason,
            outdatedDcl: p.outdated_dcl,
            capacityGapAmount: p.capacity_gap_amount,
            capacityGapAmount1: p.capacity_gap_amount1,
            capacityGapCurrency1: p.capacity_gap_currency1,
            capacityGapAmountDate: p.capacity_gap_amount_date,
            retainedCapacityGap: p.retained_capacity_gap,
            uninsuredAmount: p.uninsured_amount,
            modifiedAt: p.modified_at,
        });
    });

    const invoices = await prisma.invoice.findMany({
        where: { customer_id: customerId },
        orderBy: { invoice_date: 'desc' },
        select: {
            id: true,
            invoice_number: true,
            status: true,
            invoice_date: true,
            due_date: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            customer_currency: true,
            policy_id: true,
            in_capacity_gap: true,
            limit_assessed_amount: true,
            limit_assessed_currency: true,
            limit_assessed_at: true,
            capacity_gap_amount: true,
            capacity_gap_amount_limit: true,
            capacity_gap_amount_date: true,
        },
    });

    const openStatuses = new Set(['Due', 'Overdue']);
    const open = invoices.filter((inv) => openStatuses.has(String(inv.status)));

    console.log('[diagnose] Invoices summary:', {
        fetched: invoices.length,
        openCount: open.length,
        openWithoutPolicyId: open.filter((i) => i.policy_id == null).length,
        openWithoutLimitSnapshot: open.filter((i) => i.limit_assessed_amount == null).length,
        openWithZeroGapLimit: open.filter((i) => Number(i.capacity_gap_amount_limit ?? 0) === 0).length,
        openSumOutstanding: open.reduce((s, i) => s + Number(i.outstanding_debt ?? 0), 0),
        openSumGapLimit: open.reduce((s, i) => s + Number(i.capacity_gap_amount_limit ?? 0), 0),
        openSumGapBase: open.reduce((s, i) => s + Number(i.capacity_gap_amount ?? 0), 0),
    });

    const assessedTimes = open
        .map((i) => i.limit_assessed_at)
        .filter(Boolean)
        .map((d) => new Date(d).getTime());
    console.log('[diagnose] Assessed-limit distribution:', {
        openWithAssessedZero: open.filter((i) => Number(i.limit_assessed_amount ?? -1) === 0).length,
        openWithAssessedPositive: open.filter((i) => Number(i.limit_assessed_amount ?? 0) > 0).length,
        openSumAssessed: open.reduce((s, i) => s + Number(i.limit_assessed_amount ?? 0), 0),
        earliestLimitAssessedAt: assessedTimes.length ? new Date(Math.min(...assessedTimes)) : null,
        latestLimitAssessedAt: assessedTimes.length ? new Date(Math.max(...assessedTimes)) : null,
        activePolicyModifiedAt: policies.find((p) => p.is_active)?.modified_at ?? null,
    });

    const jobs = await prisma.importJob.findMany({
        where: { account_id: customer.account_id },
        orderBy: { created_at: 'desc' },
        take: 12,
        select: {
            id: true,
            import_type: true,
            status: true,
            total_records: true,
            successful_records: true,
            started_at: true,
            completed_at: true,
        },
    });
    jobs.forEach((j, i) => {
        console.log(`[diagnose] importJob${i}:`, {
            jobId: j.id,
            importType: String(j.import_type),
            status: String(j.status),
            totalRecords: j.total_records,
            successfulRecords: j.successful_records,
            startedAt: j.started_at,
            completedAt: j.completed_at,
        });
    });

    open.slice(0, 10).forEach((inv, i) => {
        console.log(`[diagnose] openInvoice${i}:`, {
            invoiceId: inv.id,
            invoiceNumber: inv.invoice_number,
            status: String(inv.status),
            invoiceDate: inv.invoice_date,
            dueDate: inv.due_date,
            customerCurrency: inv.customer_currency,
            outstandingDebt: inv.outstanding_debt ? String(inv.outstanding_debt) : null,
            customerOutstandingDebt: inv.customer_outstanding_debt
                ? String(inv.customer_outstanding_debt)
                : null,
            policyId: inv.policy_id,
            inCapacityGap: inv.in_capacity_gap,
            limitAssessedAmount: inv.limit_assessed_amount ? String(inv.limit_assessed_amount) : null,
            limitAssessedCurrency: inv.limit_assessed_currency,
            limitAssessedAt: inv.limit_assessed_at,
            capacityGapAmount: inv.capacity_gap_amount ? String(inv.capacity_gap_amount) : null,
            capacityGapAmountLimit: inv.capacity_gap_amount_limit
                ? String(inv.capacity_gap_amount_limit)
                : null,
            capacityGapAmountDate: inv.capacity_gap_amount_date,
        });
    });

    const gapInvoices = open.filter(
        (inv) => inv.in_capacity_gap === true || Number(inv.capacity_gap_amount_limit ?? 0) > 0
    );
    const csvPath = writeGapInvoicesCsv(customerId, gapInvoices);
    console.log('[diagnose] Capacity-gap invoice export:', {
        customerId,
        gapInvoiceCount: gapInvoices.length,
        sumGapLimit: gapInvoices.reduce((s, i) => s + Number(i.capacity_gap_amount_limit ?? 0), 0),
        csvPath,
    });
}

main()
    .catch((error) => {
        console.error('[diagnose] Failed:', {
            errorMessage: error?.message,
            errorStack: error?.stack,
        });
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
