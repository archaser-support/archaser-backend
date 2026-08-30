"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeZeroOutstandingDebtInvoices = closeZeroOutstandingDebtInvoices;
const billing_connector_1 = require("@archaser/billing-connector");
const credit_insurance_domain_1 = require("@archaser/credit-insurance-domain");
const customersDomain_1 = require("./customersDomain");
const INVOICE_STATUS = {
    DUE: "Due",
    OVERDUE: "Overdue",
    PAID: "Paid",
};
/**
 * Close Due/Overdue invoices with near-zero customer outstanding debt
 * (within ±account paid tolerance, else ±INVOICE_PAID_TOLERANCE), then
 * recalculate customer rollups and refresh credit-insurance fields. Large
 * negative outstanding (credit notes) is not treated as Paid.
 */
async function closeZeroOutstandingDebtInvoices(prisma) {
    const start = Date.now();
    const openInvoices = await prisma.invoice.findMany({
        where: {
            status: { in: [INVOICE_STATUS.DUE, INVOICE_STATUS.OVERDUE] },
        },
        select: {
            id: true,
            net_amount: true,
            total_paid: true,
            customer_net_amount: true,
            customer_total_paid: true,
            amount: true,
            customer_amount: true,
            customer_id: true,
        },
    });
    for (const inv of openInvoices) {
        const customerNet = inv.customer_net_amount ?? inv.customer_amount ?? 0;
        const customerPaid = inv.customer_total_paid ?? 0;
        const net = inv.net_amount ?? inv.amount ?? 0;
        const paid = inv.total_paid ?? 0;
        await prisma.invoice.update({
            where: { id: inv.id },
            data: {
                customer_outstanding_debt: customerNet - customerPaid,
                outstanding_debt: net - paid,
            },
        });
    }
    const connectors = await prisma.billingConnector.findMany({
        select: { account_id: true, invoice_paid_tolerance: true },
    });
    const toleranceByAccount = new Map();
    for (const connector of connectors) {
        const value = Number(connector.invoice_paid_tolerance);
        toleranceByAccount.set(connector.account_id, Number.isFinite(value) ? value : billing_connector_1.INVOICE_PAID_TOLERANCE);
    }
    const candidates = await prisma.invoice.findMany({
        where: {
            customer_outstanding_debt: {
                gte: -billing_connector_1.INVOICE_PAID_TOLERANCE_MAX,
                lte: billing_connector_1.INVOICE_PAID_TOLERANCE_MAX,
            },
            status: {
                in: [INVOICE_STATUS.DUE, INVOICE_STATUS.OVERDUE],
            },
        },
        select: {
            id: true,
            customer_id: true,
            account_id: true,
            customer_outstanding_debt: true,
        },
    });
    const invoices = candidates.filter((invoice) => (0, billing_connector_1.isWithinPaidTolerance)(invoice.customer_outstanding_debt ?? 0, toleranceByAccount.get(invoice.account_id) ?? billing_connector_1.INVOICE_PAID_TOLERANCE));
    if (invoices.length === 0) {
        return {
            success: true,
            message: "No zero-debt Due/Overdue invoices to close",
            summary: { invoicesClosed: 0, customersRecalculated: 0 },
            durationMs: Date.now() - start,
        };
    }
    await prisma.invoice.updateMany({
        where: { id: { in: invoices.map((invoice) => invoice.id) } },
        data: {
            status: INVOICE_STATUS.PAID,
            zero_limit_alert: false,
            reporting_breach: false,
        },
    });
    const customerIds = Array.from(new Set(invoices
        .map((invoice) => invoice.customer_id)
        .filter((id) => id !== null && id !== undefined)));
    await (0, customersDomain_1.recalculateCustomerAmountsViaApi)(customerIds, prisma);
    (0, credit_insurance_domain_1.bindCreditInsurancePrisma)(prisma);
    for (const customerId of customerIds) {
        await (0, credit_insurance_domain_1.syncCustomerInsuranceFields)(customerId);
    }
    return {
        success: true,
        message: `Closed ${invoices.length} zero-debt invoices across ${customerIds.length} customers`,
        summary: {
            invoicesClosed: invoices.length,
            customersRecalculated: customerIds.length,
        },
        durationMs: Date.now() - start,
    };
}
