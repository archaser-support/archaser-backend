/**
 * Backfill invoices for the future-payment settle gate.
 *
 * For invoices with linked real cash still dated after `asOf` (default: now):
 * 1. Delete premature recon virtual payments (10149 virtual fill before FNCDATE).
 * 2. Recalc outstanding / total_paid / Paid using payments effective as of `asOf`.
 * 3. Reopen invoices stuck on Paid when effective cover is no longer within
 *    paid tolerance (recalc alone keeps prior Paid status).
 *
 * Optionally refresh customer due/overdue rollups for touched customers.
 *
 * Usage:
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/reapply-future-payment-settle-gate.ts --account 10149 --dry-run
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/reapply-future-payment-settle-gate.ts --account 10149 --fix
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/reapply-future-payment-settle-gate.ts --account 10149 --fix --repair-rollups
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/reapply-future-payment-settle-gate.ts --account 10149 --dry-run --as-of 2026-10-01
 */
import "dotenv/config";
import * as path from "path";
import { PrismaClient, type invoice_status } from "@prisma/client";

import { hasFutureDatedRealCash } from "../../packages/billing-connector/src/extensions/account_10149/reconciledVirtualClose";
import { recalculateInvoicesFromLinkedPayments } from "../../packages/billing-connector/src/invoice/linkDeferredPaymentAndRecalc";
import {
    isWithinPaidTolerance,
    resolveInvoicePaidTolerance,
} from "../../packages/billing-connector/src/invoice/invoicePaidTolerance";
import { paymentsEffectiveAsOf } from "../../packages/billing-connector/src/invoice/paymentsEffectiveAsOf";
import {
    VIRTUAL_PAYMENT_METHOD,
    isVirtualPaymentMethod,
} from "../../packages/billing-connector/src/payment/virtualPaymentTrim";

const LOG = "[reapply-future-settle-gate]";
const RECALC_CHUNK = 200;
const SAMPLE_LIMIT = 25;

type Args = {
    accountId: number;
    dryRun: boolean;
    fix: boolean;
    asOf: Date;
    repairRollups: boolean;
    limit: number | null;
};

function parseAsOf(raw: string | undefined): Date {
    if (raw == null || raw.trim() === "") {
        return new Date();
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (!match) {
        throw new Error("--as-of must be YYYY-MM-DD");
    }
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}T23:59:59.999Z`);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid --as-of date: ${raw}`);
    }
    return date;
}

function parseArgs(argv: string[]): Args {
    const accountIdx = argv.indexOf("--account");
    const accountId = Number(accountIdx === -1 ? NaN : argv[accountIdx + 1]);
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new Error("--account <id> is required");
    }

    const dryRun = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }

    const asOfIdx = argv.indexOf("--as-of");
    const asOf = parseAsOf(asOfIdx === -1 ? undefined : argv[asOfIdx + 1]);

    const limitIdx = argv.indexOf("--limit");
    const limit =
        limitIdx === -1
            ? null
            : Number(argv[limitIdx + 1]);
    if (limit != null && (!Number.isInteger(limit) || limit <= 0)) {
        throw new Error("--limit must be a positive integer");
    }

    return {
        accountId,
        dryRun,
        fix,
        asOf,
        repairRollups: argv.includes("--repair-rollups"),
        limit,
    };
}

function resolveOpenStatus(
    dueDate: Date | null,
    asOf: Date
): Extract<invoice_status, "Due" | "Overdue"> {
    if (dueDate != null && dueDate.getTime() < asOf.getTime()) {
        return "Overdue";
    }
    return "Due";
}

type CandidateRow = {
    invoiceId: number;
    invoiceNumber: string | null;
    customerId: number | null;
    status: invoice_status;
    dueDate: Date | null;
    customerNet: number | null;
    customerTotalPaid: number | null;
    outstandingDebt: number | null;
    futureRealPaymentCount: number;
    prematureVirtualIds: number[];
    wouldReopenFromPaid: boolean;
};

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        const paidTolerance = await resolveInvoicePaidTolerance(
            prisma,
            args.accountId
        );

        const futureDatedPayments = await prisma.invoicePayment.findMany({
            where: {
                account_id: args.accountId,
                invoice_id: { not: null },
                payment_date: { gt: args.asOf },
            },
            select: {
                invoice_id: true,
                payment_method: true,
            },
        });

        let invoiceIds = Array.from(
            new Set(
                futureDatedPayments
                    .filter(
                        (row) => !isVirtualPaymentMethod(row.payment_method)
                    )
                    .map((row) => row.invoice_id)
                    .filter((id): id is number => id != null)
            )
        ).sort((a, b) => a - b);

        if (args.limit != null) {
            invoiceIds = invoiceIds.slice(0, args.limit);
        }

        console.log(`${LOG} scan start`, {
            accountId: args.accountId,
            mode: args.fix ? "fix" : "dry-run",
            asOf: args.asOf.toISOString(),
            paidTolerance,
            invoicesWithFutureRealCash: invoiceIds.length,
            repairRollups: args.repairRollups,
            limit: args.limit,
        });

        if (invoiceIds.length === 0) {
            console.log(`${LOG} nothing to update`);
            return;
        }

        const [invoices, linkedPayments] = await Promise.all([
            prisma.invoice.findMany({
                where: { id: { in: invoiceIds }, account_id: args.accountId },
                select: {
                    id: true,
                    invoice_number: true,
                    customer_id: true,
                    status: true,
                    due_date: true,
                    customer_net_amount: true,
                    customer_total_paid: true,
                    outstanding_debt: true,
                },
            }),
            prisma.invoicePayment.findMany({
                where: { invoice_id: { in: invoiceIds } },
                select: {
                    id: true,
                    invoice_id: true,
                    payment_date: true,
                    payment_method: true,
                    customer_amount: true,
                },
            }),
        ]);

        const paymentsByInvoice = new Map<number, typeof linkedPayments>();
        for (const payment of linkedPayments) {
            if (payment.invoice_id == null) continue;
            const list = paymentsByInvoice.get(payment.invoice_id) ?? [];
            list.push(payment);
            paymentsByInvoice.set(payment.invoice_id, list);
        }

        const candidates: CandidateRow[] = [];
        const prematureVirtualIds: number[] = [];
        const reopenInvoiceIds: number[] = [];

        for (const invoice of invoices) {
            const linked = paymentsByInvoice.get(invoice.id) ?? [];
            const futureRealCount = linked.filter(
                (payment) =>
                    !isVirtualPaymentMethod(payment.payment_method) &&
                    payment.payment_date.getTime() > args.asOf.getTime()
            ).length;

            const virtualIdsToDelete: number[] = [];
            if (hasFutureDatedRealCash(linked, args.asOf)) {
                for (const payment of linked) {
                    if (isVirtualPaymentMethod(payment.payment_method)) {
                        virtualIdsToDelete.push(payment.id);
                    }
                }
            }

            const paymentsAfterVirtualDelete = linked.filter(
                (payment) => !virtualIdsToDelete.includes(payment.id)
            );
            const effective = paymentsEffectiveAsOf(
                paymentsAfterVirtualDelete,
                args.asOf
            );
            let effectiveCustomerPaid = 0;
            for (const payment of effective) {
                effectiveCustomerPaid += payment.customer_amount ?? 0;
            }
            const remaining =
                (invoice.customer_net_amount ?? 0) - effectiveCustomerPaid;
            const stillPaid = isWithinPaidTolerance(remaining, paidTolerance);
            const wouldReopenFromPaid =
                invoice.status === "Paid" && !stillPaid;

            if (
                virtualIdsToDelete.length === 0 &&
                !wouldReopenFromPaid &&
                stillPaid === (invoice.status === "Paid") &&
                Math.abs(
                    (invoice.customer_total_paid ?? 0) - effectiveCustomerPaid
                ) <= 0.001
            ) {
                // Already aligned with as-of settle (no premature virtual, totals match).
                continue;
            }

            prematureVirtualIds.push(...virtualIdsToDelete);
            if (wouldReopenFromPaid) {
                reopenInvoiceIds.push(invoice.id);
            }

            candidates.push({
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoice_number,
                customerId: invoice.customer_id,
                status: invoice.status,
                dueDate: invoice.due_date,
                customerNet: invoice.customer_net_amount,
                customerTotalPaid: invoice.customer_total_paid,
                outstandingDebt: invoice.outstanding_debt,
                futureRealPaymentCount: futureRealCount,
                prematureVirtualIds: virtualIdsToDelete,
                wouldReopenFromPaid,
            });
        }

        console.log(`${LOG} candidates`, {
            invoicesToTouch: candidates.length,
            prematureVirtualsToDelete: prematureVirtualIds.length,
            paidToReopen: reopenInvoiceIds.length,
        });

        for (const row of candidates.slice(0, SAMPLE_LIMIT)) {
            console.log(`${LOG} sample`, {
                invoiceId: row.invoiceId,
                invoiceNumber: row.invoiceNumber,
                customerId: row.customerId,
                status: row.status,
                customerNet: row.customerNet,
                customerTotalPaid: row.customerTotalPaid,
                outstandingDebt: row.outstandingDebt,
                futureRealPayments: row.futureRealPaymentCount,
                deleteVirtualIds: row.prematureVirtualIds,
                reopenFromPaid: row.wouldReopenFromPaid,
                reopenTo: row.wouldReopenFromPaid
                    ? resolveOpenStatus(row.dueDate, args.asOf)
                    : null,
            });
        }
        if (candidates.length > SAMPLE_LIMIT) {
            console.log(`${LOG} ...`, {
                additionalCandidates: candidates.length - SAMPLE_LIMIT,
            });
        }

        if (!args.fix || candidates.length === 0) {
            return;
        }

        if (prematureVirtualIds.length > 0) {
            const deleted = await prisma.invoicePayment.deleteMany({
                where: {
                    id: { in: prematureVirtualIds },
                    account_id: args.accountId,
                    payment_method: VIRTUAL_PAYMENT_METHOD,
                },
            });
            console.log(`${LOG} deleted premature virtuals`, {
                deleted: deleted.count,
            });
        }

        const targetIds = candidates.map((row) => row.invoiceId);
        for (let offset = 0; offset < targetIds.length; offset += RECALC_CHUNK) {
            const chunk = targetIds.slice(offset, offset + RECALC_CHUNK);
            const targets = new Map<number, { asOf: Date }>();
            for (const id of chunk) {
                targets.set(id, { asOf: args.asOf });
            }
            await recalculateInvoicesFromLinkedPayments(prisma, targets);
            console.log(`${LOG} recalc progress`, {
                processed: Math.min(offset + chunk.length, targetIds.length),
                total: targetIds.length,
            });
        }

        const reopenRows = candidates.filter((row) => row.wouldReopenFromPaid);
        const reopenByStatus = new Map<
            Extract<invoice_status, "Due" | "Overdue">,
            number[]
        >();
        for (const row of reopenRows) {
            const nextStatus = resolveOpenStatus(row.dueDate, args.asOf);
            const list = reopenByStatus.get(nextStatus) ?? [];
            list.push(row.invoiceId);
            reopenByStatus.set(nextStatus, list);
        }
        const reopenModifiedAt = new Date();
        for (const [status, ids] of reopenByStatus) {
            for (let offset = 0; offset < ids.length; offset += RECALC_CHUNK) {
                const chunk = ids.slice(offset, offset + RECALC_CHUNK);
                await prisma.invoice.updateMany({
                    where: { id: { in: chunk }, account_id: args.accountId },
                    data: {
                        status,
                        close_date: null,
                        modified_at: reopenModifiedAt,
                    },
                });
            }
        }
        console.log(`${LOG} reopened from Paid`, {
            count: reopenRows.length,
            due: reopenByStatus.get("Due")?.length ?? 0,
            overdue: reopenByStatus.get("Overdue")?.length ?? 0,
        });

        if (args.repairRollups) {
            if (!process.env.CUSTOMERS_DOMAIN_ROOT) {
                process.env.CUSTOMERS_DOMAIN_ROOT = path.resolve(
                    __dirname,
                    "../../api/dist/customers"
                );
            }
            const { recalculateCustomerAmountsViaApi } = await import(
                "../../packages/cron-jobs/src/customersDomain"
            );
            const customerIds = Array.from(
                new Set(
                    candidates
                        .map((row) => row.customerId)
                        .filter((id): id is number => id != null)
                )
            );
            if (customerIds.length > 0) {
                await recalculateCustomerAmountsViaApi(customerIds, prisma);
                console.log(`${LOG} repaired customer rollups`, {
                    customers: customerIds.length,
                });
            }
        } else {
            console.log(
                `${LOG} skip rollups (pass --repair-rollups to refresh customer due/overdue counts)`
            );
        }

        console.log(`${LOG} applied`, {
            invoicesTouched: candidates.length,
            virtualsDeleted: prematureVirtualIds.length,
            reopenedFromPaid: reopenRows.length,
        });
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(`${LOG} failed`, error);
    process.exit(1);
});
