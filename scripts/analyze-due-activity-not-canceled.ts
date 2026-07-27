/**
 * Analyzes why a scheduled due activity was not canceled after an invoice status
 * changed from Due to Paid.
 *
 * Expected flow: When an invoice becomes non-DUE (e.g. paid), InvoiceService.handleInvoiceChange
 * should run and call DueNotificationService.cancelDueNotificationsForInvoices([invoice.id]),
 * which cancels SCHEDULED due activities that include that invoice (matched by invoice_number in title_params).
 *
 * This script checks:
 * 1. Invoice current state (status_id, due_notification_state, invoice_number, customer_id)
 * 2. All due activities for the customer (SCHEDULED or other) and whether they reference this invoice
 * 3. Why cancelDueNotificationsForInvoices might not have canceled them (no handleInvoiceChange call,
 *    activity not SCHEDULED, title_params missing or format mismatch, invoice_number null, etc.)
 * 4. Code paths that can set invoice to Paid without calling handleInvoiceChange
 *
 * Usage:
 *   npx tsx scripts/analyze-due-activity-not-canceled.ts --customer-id 1576
 *   npx tsx scripts/analyze-due-activity-not-canceled.ts <invoice_id>
 *   npx tsx scripts/analyze-due-activity-not-canceled.ts --invoice-number "INV-001" --customer-id 123
 */

import { prisma } from "@/lib/prisma";

const INVOICE_STATUS = { OVERDUE: 3, PAID: 7, DUE: 13 } as const;

type AnalysisResult = {
    invoiceId: number;
    invoiceNumber: string | null;
    customerId: number | null;
    statusId: number;
    statusName: string | null;
    dueNotificationState: unknown;
    wouldTriggerCancel: boolean;
    reasons: string[];
    dueActivities: Array<{
        id: number;
        status: string;
        scheduleTime: Date | null;
        titleParams: unknown;
        invoiceNumbersInActivity: string[];
        containsThisInvoice: boolean;
        whyNotCanceled?: string;
    }>;
    codePathsNotCallingHandleInvoiceChange: string[];
};

async function getInvoiceById(id: number) {
    return prisma.invoice.findUnique({
        where: { id },
        include: {
            InvoiceStatus: { select: { id: true, name: true, state: true } },
        },
    });
}

async function getInvoiceByNumberAndCustomer(
    invoiceNumber: string,
    customerId: number
) {
    return prisma.invoice.findFirst({
        where: { invoice_number: invoiceNumber, customer_id: customerId },
        include: {
            InvoiceStatus: { select: { id: true, name: true, state: true } },
        },
    });
}

async function getPaidInvoicesForCustomer(customerId: number) {
    return prisma.invoice.findMany({
        where: { customer_id: customerId, status_id: INVOICE_STATUS.PAID },
        include: {
            InvoiceStatus: { select: { id: true, name: true, state: true } },
        },
        orderBy: { id: "asc" },
    });
}

async function getDueActivitiesForCustomer(customerId: number) {
    return prisma.activity.findMany({
        where: {
            customer_id: customerId,
            ActivitiesSequence: { step_type: "due" },
        },
        include: {
            ActivitiesSequence: {
                select: { id: true, step_type: true, step: true },
            },
        },
        orderBy: { schedule_time: "asc" },
    });
}

function parseInvoiceNumbersFromTitleParams(titleParams: unknown): string[] {
    if (!titleParams || typeof titleParams !== "object") return [];
    const o = titleParams as Record<string, unknown>;
    const str =
        (o.invoiceNumber as string) ?? (o.invoice_numbers as string) ?? "";
    if (typeof str !== "string") return [];
    return str
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function analyze(
    invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceById>>>,
    dueActivities: Awaited<ReturnType<typeof getDueActivitiesForCustomer>>
): AnalysisResult {
    const reasons: string[] = [];
    const wouldTriggerCancel =
        invoice.status_id !== INVOICE_STATUS.DUE &&
        invoice.customer_id != null &&
        invoice.invoice_number != null;

    if (invoice.status_id === INVOICE_STATUS.DUE) {
        reasons.push(
            "Invoice is still DUE (status_id=13). handleInvoiceChange only cancels due notifications when currentInvoice.status_id !== DUE."
        );
    }
    if (!invoice.customer_id) {
        reasons.push(
            "Invoice has no customer_id; cancelDueNotificationsForInvoices groups by customer and would skip."
        );
    }
    if (!invoice.invoice_number) {
        reasons.push(
            "Invoice has no invoice_number; cancelDueNotificationsForInvoices matches activities by invoice_number in title_params, so it would skip this invoice in the disputedNumbers set."
        );
    }

    const activityResults = dueActivities.map((a) => {
        const invoiceNumbersInActivity = parseInvoiceNumbersFromTitleParams(
            a.title_params
        );
        const containsThisInvoice =
            !!invoice.invoice_number &&
            invoiceNumbersInActivity.some(
                (n) => n === invoice.invoice_number?.trim()
            );
        let whyNotCanceled: string | undefined;
        if (containsThisInvoice && a.status !== "SCHEDULED") {
            whyNotCanceled = `Activity status is "${a.status}". cancelDueNotificationsForInvoices only finds and cancels activities with status 'SCHEDULED'.`;
        } else if (containsThisInvoice && a.status === "SCHEDULED") {
            whyNotCanceled = wouldTriggerCancel
                ? "Activity should have been canceled if handleInvoiceChange ran and cancelDueNotificationsForInvoices was called."
                : "Activity contains this invoice and is SCHEDULED; cancellation did not run because handleInvoiceChange was not triggered (see reasons above).";
        } else if (!invoiceNumbersInActivity.length) {
            whyNotCanceled =
                "Activity has no invoiceNumber/invoice_numbers in title_params; cancelDueNotificationsForInvoices skips it (continue).";
        } else {
            whyNotCanceled = `Activity lists invoices: ${invoiceNumbersInActivity.join(", ")}. This invoice (${invoice.invoice_number ?? "null"}) is not in the list — possible format mismatch (e.g. leading zeros, spacing).`;
        }
        return {
            id: a.id,
            status: a.status,
            scheduleTime: a.schedule_time,
            titleParams: a.title_params,
            invoiceNumbersInActivity,
            containsThisInvoice,
            whyNotCanceled,
        };
    });

    const codePathsNotCallingHandleInvoiceChange: string[] = [];
    if (invoice.status_id === INVOICE_STATUS.PAID) {
        codePathsNotCallingHandleInvoiceChange.push(
            "fixClosedCollectionData: uses prisma.invoice.updateMany({ status_id: PAID }) and never calls handleInvoiceChange for affected invoices."
        );
        codePathsNotCallingHandleInvoiceChange.push(
            "handleInvoicesStateUpdate (entities API): updates InvoiceStatus.state (e.g. to Close) only; does not update Invoice.status_id and does not call handleInvoiceChange. If the UI only updates 'state', due activities are not canceled."
        );
        codePathsNotCallingHandleInvoiceChange.push(
            "Direct DB updates or imports that set status_id to PAID without going through InvoiceService (e.g. raw SQL or updateMany without per-invoice handleInvoiceChange)."
        );
    }

    return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        customerId: invoice.customer_id,
        statusId: invoice.status_id,
        statusName: invoice.InvoiceStatus?.name ?? null,
        dueNotificationState: invoice.due_notification_state,
        wouldTriggerCancel,
        reasons,
        dueActivities: activityResults,
        codePathsNotCallingHandleInvoiceChange,
    };
}

function printReport(result: AnalysisResult) {
    console.log("\n--- Invoice", result.invoiceId, "---");
    console.log("Invoice:", {
        invoiceId: result.invoiceId,
        invoiceNumber: result.invoiceNumber,
        customerId: result.customerId,
        statusId: result.statusId,
        statusName: result.statusName,
        dueNotificationState: result.dueNotificationState,
    });
    console.log("Would handleInvoiceChange trigger cancellation?", result.wouldTriggerCancel);
    if (result.reasons.length) {
        console.log("Reasons cancellation might not run:");
        result.reasons.forEach((r) => console.log("  -", r));
    }
    console.log("Due activities for this customer:");
    result.dueActivities.forEach((a) => {
        console.log(`  Activity ${a.id}: status=${a.status}, schedule_time=${a.scheduleTime?.toISOString() ?? null}`);
        console.log("    title_params invoice numbers:", a.invoiceNumbersInActivity);
        console.log("    contains this invoice:", a.containsThisInvoice);
        if (a.whyNotCanceled) console.log("    why not canceled:", a.whyNotCanceled);
    });
    if (result.codePathsNotCallingHandleInvoiceChange.length) {
        console.log("Code paths that can set invoice to Paid without calling handleInvoiceChange:");
        result.codePathsNotCallingHandleInvoiceChange.forEach((p) =>
            console.log("  -", p)
        );
    }
    if (
        result.statusId === INVOICE_STATUS.PAID &&
        result.dueActivities.some((a) => a.containsThisInvoice && a.status === "SCHEDULED")
    ) {
        console.log("Suggested fix: Call InvoiceService.handleInvoiceChange(invoice) for this invoice to cancel the scheduled due activity (e.g. from a one-off script or by fixing the code path that set status to Paid).");
    }
}

function printCustomerReport(
    customerId: number,
    customerName: string | null,
    paidInvoices: Awaited<ReturnType<typeof getPaidInvoicesForCustomer>>,
    dueActivities: Awaited<ReturnType<typeof getDueActivitiesForCustomer>>,
    results: AnalysisResult[]
) {
    console.log("\n=== Due activity not canceled – analysis for customer", customerId, customerName ? `(${customerName})` : "", "===\n");

    const scheduledDue = dueActivities.filter((a) => a.status === "SCHEDULED");
    const problemActivities = scheduledDue.filter((a) => {
        const nums = parseInvoiceNumbersFromTitleParams(a.title_params);
        return paidInvoices.some(
            (inv) => inv.invoice_number && nums.some((n) => n === inv.invoice_number?.trim())
        );
    });

    console.log("Summary:");
    console.log("  Paid invoices for customer:", paidInvoices.length);
    console.log("  Due activities (all statuses):", dueActivities.length);
    console.log("  SCHEDULED due activities:", scheduledDue.length);
    console.log(
        "  SCHEDULED due activities that reference at least one paid invoice (should have been canceled):",
        problemActivities.length
    );
    if (dueActivities.length > 0) {
        console.log("\nDue activities (id, status, schedule_time, title_params invoice numbers):");
        dueActivities.forEach((a) => {
            const nums = parseInvoiceNumbersFromTitleParams(a.title_params);
            console.log(`  Activity ${a.id}: status=${a.status}, schedule_time=${a.schedule_time?.toISOString() ?? null}, invoice_numbers=[${nums.join(", ")}]`);
        });
    }

    if (problemActivities.length > 0) {
        console.log("\nProblem SCHEDULED due activities (still exist but reference paid invoices):");
        problemActivities.forEach((a) => {
            const nums = parseInvoiceNumbersFromTitleParams(a.title_params);
            const matchingInvoices = paidInvoices.filter(
                (inv) => inv.invoice_number && nums.includes(inv.invoice_number.trim())
            );
            console.log(`  Activity ${a.id}: schedule_time=${a.schedule_time?.toISOString() ?? null}, title_params invoice numbers: [${nums.join(", ")}]`);
            console.log(`    Paid invoices in this activity: ${matchingInvoices.map((i) => i.invoice_number).join(", ")}`);
        });
    }

    const hasUncanceled = results.some((r) =>
        r.dueActivities.some((a) => a.containsThisInvoice && a.status === "SCHEDULED")
    );
    if (hasUncanceled) {
        console.log("\n--- Per-invoice analysis (paid invoices with uncanceled due activities) ---");
        results.forEach((r) => {
            if (r.dueActivities.some((a) => a.containsThisInvoice && a.status === "SCHEDULED")) {
                printReport(r);
            }
        });
    }

    console.log("\nCode paths that can set invoice to Paid without calling handleInvoiceChange:");
    console.log("  - fixClosedCollectionData: uses prisma.invoice.updateMany({ status_id: PAID }) and never calls handleInvoiceChange for affected invoices.");
    console.log("  - handleInvoicesStateUpdate (entities API): updates InvoiceStatus.state only; does not update Invoice.status_id. If the UI only updates 'state', due activities are not canceled.");
    console.log("  - Direct DB updates or imports that set status_id to PAID without going through InvoiceService.");

    console.log("\n=== End analysis ===\n");
}

async function main() {
    const args = process.argv.slice(2);
    let invoiceId: number | null = null;
    let invoiceNumber: string | null = null;
    let customerIdArg: number | null = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--invoice-number" && args[i + 1]) {
            invoiceNumber = args[++i];
        } else if (args[i] === "--customer-id" && args[i + 1]) {
            customerIdArg = parseInt(args[++i], 10);
        } else if (!args[i].startsWith("--")) {
            const n = parseInt(args[i], 10);
            if (!Number.isNaN(n)) invoiceId = n;
        }
    }

    // Mode: analyze by customer ID only (e.g. customer 1576)
    if (customerIdArg != null && invoiceId == null && invoiceNumber == null) {
        const customerId = customerIdArg;
        const customer = await prisma.customer.findUnique({
            where: { id: customerId },
            select: { id: true, customer_number: true },
        });
        if (!customer) {
            console.error("Customer not found:", customerId);
            process.exit(1);
        }
        const paidInvoices = await getPaidInvoicesForCustomer(customerId);
        const dueActivities = await getDueActivitiesForCustomer(customerId);
        const results: AnalysisResult[] = paidInvoices.map((inv) =>
            analyze(inv, dueActivities)
        );
        printCustomerReport(customerId, customer?.customer_number ?? null, paidInvoices, dueActivities, results);
        return;
    }

    // Mode: single invoice by id or by invoice-number + customer-id
    let invoice: Awaited<ReturnType<typeof getInvoiceById>>;
    if (invoiceId != null) {
        invoice = await getInvoiceById(invoiceId);
    } else if (invoiceNumber != null && customerIdArg != null) {
        invoice = await getInvoiceByNumberAndCustomer(invoiceNumber, customerIdArg);
    } else {
        console.error(
            "Usage: npx tsx scripts/analyze-due-activity-not-canceled.ts --customer-id 1576"
        );
        console.error(
            "  or:  npx tsx scripts/analyze-due-activity-not-canceled.ts <invoice_id>"
        );
        console.error(
            '  or:  npx tsx scripts/analyze-due-activity-not-canceled.ts --invoice-number "INV-001" --customer-id 123'
        );
        process.exit(1);
    }

    if (!invoice) {
        console.error("Invoice not found.");
        process.exit(1);
    }

    const customerIdForActivities = invoice.customer_id;
    if (customerIdForActivities == null) {
        console.error("Invoice has no customer_id; cannot fetch due activities.");
        process.exit(1);
    }

    const dueActivities = await getDueActivitiesForCustomer(
        customerIdForActivities
    );
    const result = analyze(invoice, dueActivities);
    console.log("\n=== Due activity not canceled – analysis ===\n");
    printReport(result);
    console.log("\n=== End analysis ===\n");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
