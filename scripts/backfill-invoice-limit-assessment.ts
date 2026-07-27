/**
 * One-time backfill for open invoices missing limit_assessed_* snapshots.
 * Uses FIFO by invoice id within (customer_id, policy_id): assessed headroom =
 * max(0, current approved limit - open AR on sibling invoices processed earlier).
 *
 * Usage: npx tsx scripts/backfill-invoice-limit-assessment.ts [--dry-run] [--account-id=123]
 */
import { invoice_status } from "@prisma/client";

import { prisma } from "../frontend/lib/prisma";
import {
    computeLimitAssessedAmountForNewOpenInvoice,
    invoiceOutstandingLeft,
} from "../frontend/server/services/creditInsurance/invoiceInsuranceFields";
import { loadEffectiveInsuranceForCustomers } from "../frontend/server/services/creditInsurance/loadEffectiveInsuranceForCustomers";

const dryRun = process.argv.includes("--dry-run");
const accountIdArg = process.argv.find((a) => a.startsWith("--account-id="));
const accountIdFilter = accountIdArg
    ? Number.parseInt(accountIdArg.split("=")[1] ?? "", 10)
    : undefined;

async function main() {
    const openInvoices = await prisma.invoice.findMany({
        where: {
            limit_assessed_amount: null,
            policy_id: { not: null },
            status: { in: [invoice_status.Due, invoice_status.Overdue] },
            ...(accountIdFilter != null && Number.isFinite(accountIdFilter)
                ? { account_id: accountIdFilter }
                : {}),
        },
        select: {
            id: true,
            account_id: true,
            customer_id: true,
            policy_id: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            amount: true,
        },
        orderBy: [{ customer_id: "asc" }, { policy_id: "asc" }, { id: "asc" }],
    });

    const customerIds = Array.from(
        new Set(
            openInvoices
                .map((i) => i.customer_id)
                .filter((id): id is number => id != null)
        )
    );
    const insuranceByCustomer =
        await loadEffectiveInsuranceForCustomers(customerIds);

    const runningOpenAr = new Map<string, number>();
    let updated = 0;
    let skipped = 0;

    for (const inv of openInvoices) {
        if (inv.customer_id == null || inv.policy_id == null) {
            skipped += 1;
            continue;
        }
        const ctx = insuranceByCustomer.get(inv.customer_id);
        if (!ctx?.approved_limit) {
            skipped += 1;
            continue;
        }
        const scopeKey = `${inv.customer_id}:${inv.policy_id}`;
        const openBefore = runningOpenAr.get(scopeKey) ?? 0;
        const assessed = computeLimitAssessedAmountForNewOpenInvoice({
            approvedLimit: Number(ctx.approved_limit),
            openArOnPolicyBeforeInvoice: openBefore,
        });
        const outstanding = Math.max(0, invoiceOutstandingLeft(inv));
        runningOpenAr.set(scopeKey, openBefore + outstanding);

        if (!dryRun) {
            await prisma.invoice.update({
                where: { id: inv.id },
                data: {
                    limit_assessed_amount: assessed,
                    limit_assessed_at: new Date(),
                    limit_assessed_currency: ctx.approved_limit_currency ?? null,
                },
            });
        }
        updated += 1;
    }

    console.error(
        "[backfill-invoice-limit-assessment]",
        JSON.stringify({
            dryRun,
            accountIdFilter: accountIdFilter ?? null,
            candidates: openInvoices.length,
            updated,
            skipped,
        })
    );
}

main().catch((e) => {
    console.error("[backfill-invoice-limit-assessment] failed", e);
    process.exit(1);
});
