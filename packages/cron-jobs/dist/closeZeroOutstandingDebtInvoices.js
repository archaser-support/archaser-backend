"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeZeroOutstandingDebtInvoices = closeZeroOutstandingDebtInvoices;
const creditDomain_1 = require("./creditDomain");
const customersDomain_1 = require("./customersDomain");
const INVOICE_STATUS = {
    DUE: "Due",
    OVERDUE: "Overdue",
    PAID: "Paid",
};
/**
 * Close Due/Overdue invoices with zero customer outstanding debt, then
 * recalculate customer rollups and refresh credit-insurance fields.
 */
async function closeZeroOutstandingDebtInvoices(prisma) {
    const start = Date.now();
    const invoices = await prisma.invoice.findMany({
        where: {
            customer_outstanding_debt: 0,
            status: {
                in: [INVOICE_STATUS.DUE, INVOICE_STATUS.OVERDUE],
            },
        },
        select: {
            id: true,
            customer_id: true,
        },
    });
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
        },
    });
    const customerIds = Array.from(new Set(invoices
        .map((invoice) => invoice.customer_id)
        .filter((id) => id !== null && id !== undefined)));
    await (0, customersDomain_1.recalculateCustomerAmountsViaApi)(customerIds, prisma);
    (0, creditDomain_1.bindCreditDomain)(prisma);
    const syncMod = (0, creditDomain_1.requireCreditDomainModule)("domain/syncCustomerInsuranceFields.js");
    for (const customerId of customerIds) {
        await syncMod.syncCustomerInsuranceFields(customerId);
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
