"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMaxUpdatedAt = extractMaxUpdatedAt;
exports.importMappedEntityBatch = importMappedEntityBatch;
exports.updateAccountLastSyncDate = updateAccountLastSyncDate;
const connectorFieldUtils_1 = require("../utils/connectorFieldUtils");
function extractMaxUpdatedAt(records) {
    let max = null;
    for (const record of records) {
        const raw = record.UDATE ?? record.udate ?? record.updated_at;
        if (!raw)
            continue;
        const parsed = new Date(String(raw));
        if (Number.isNaN(parsed.getTime()))
            continue;
        if (!max || parsed > max)
            max = parsed;
    }
    return max;
}
function str(value, fallback = "") {
    if (value == null)
        return fallback;
    return String(value).trim();
}
function num(value) {
    if (value == null || value === "")
        return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}
function mapRows(records, mappingJson) {
    const rules = (0, connectorFieldUtils_1.parseMappingRules)(mappingJson);
    return records.map((record) => (0, connectorFieldUtils_1.mapErpRecord)(record, rules));
}
/**
 * Prisma-native entity upsert for connector sync (Priority deepen).
 * Does not depend on monolith Import* service graph.
 */
async function importMappedEntityBatch(prisma, importType, records, accountId, mappingJson, userId) {
    const result = {
        success: 0,
        failed: 0,
        skipped: 0,
        affectedCustomerIds: [],
        entityIds: [],
        errors: [],
    };
    const rows = mappingJson == null
        ? records
        : mapRows(records, mappingJson);
    if (rows.length === 0)
        return result;
    if (importType === "Customer") {
        for (const row of rows) {
            try {
                const customerNumber = str(row.customer_number);
                const name = str(row.name) || customerNumber;
                if (!customerNumber) {
                    result.skipped += 1;
                    continue;
                }
                const countryIso2 = str(row.country_iso2 || row.country || "IL");
                const country = await prisma.country.findFirst({
                    where: { iso2: countryIso2 },
                    select: { id: true },
                });
                if (!country) {
                    throw new Error(`Unknown country iso2: ${countryIso2}`);
                }
                const existing = await prisma.customer.findFirst({
                    where: {
                        account_id: accountId,
                        customer_number: customerNumber,
                    },
                    select: { id: true },
                });
                const data = {
                    name,
                    customer_number: customerNumber,
                    account_id: accountId,
                    country_id: country.id,
                    city: str(row.city) || null,
                    address_line1: str(row.address_line1) || null,
                    address_line2: str(row.address_line2) || null,
                    postal_code: str(row.postal_code) || null,
                    modified_by: userId || null,
                };
                const customer = existing
                    ? await prisma.customer.update({
                        where: { id: existing.id },
                        data,
                        select: { id: true },
                    })
                    : await prisma.customer.create({
                        data: {
                            ...data,
                            created_by: userId || null,
                            company_code: str(row.company_code) || "DEFAULT",
                        },
                        select: { id: true },
                    });
                result.success += 1;
                result.affectedCustomerIds.push(customer.id);
            }
            catch (error) {
                result.failed += 1;
                result.errors.push(error instanceof Error ? error.message : String(error));
            }
        }
        return result;
    }
    if (importType === "Contact") {
        for (const row of rows) {
            try {
                const customerNumber = str(row.customer_number);
                const firstName = str(row.first_name);
                if (!customerNumber || !firstName) {
                    result.skipped += 1;
                    continue;
                }
                const customer = await prisma.customer.findFirst({
                    where: {
                        account_id: accountId,
                        customer_number: customerNumber,
                    },
                    select: { id: true },
                });
                if (!customer) {
                    throw new Error(`Customer not found for contact: ${customerNumber}`);
                }
                const erpContactId = str(row.erp_contact_id) || null;
                const email = str(row.email) || null;
                const existing = erpContactId
                    ? await prisma.contact.findFirst({
                        where: {
                            customer_id: customer.id,
                            erp_contact_id: erpContactId,
                        },
                        select: { id: true },
                    })
                    : email
                        ? await prisma.contact.findFirst({
                            where: { customer_id: customer.id, email },
                            select: { id: true },
                        })
                        : null;
                const data = {
                    first_name: firstName,
                    last_name: str(row.last_name) || null,
                    email,
                    phone: str(row.phone) || null,
                    mobile: str(row.mobile) || null,
                    erp_contact_id: erpContactId,
                    customer_id: customer.id,
                    modified_by: userId || null,
                };
                if (existing) {
                    await prisma.contact.update({
                        where: { id: existing.id },
                        data: data,
                    });
                }
                else {
                    await prisma.contact.create({
                        data: {
                            ...data,
                            created_by: userId || null,
                        },
                    });
                }
                result.success += 1;
                result.affectedCustomerIds.push(customer.id);
            }
            catch (error) {
                result.failed += 1;
                result.errors.push(error instanceof Error ? error.message : String(error));
            }
        }
        return result;
    }
    if (importType === "Invoice") {
        for (const row of rows) {
            try {
                const invoiceNumber = str(row.invoice_number);
                const customerNumber = str(row.customer_number);
                if (!invoiceNumber || !customerNumber) {
                    result.skipped += 1;
                    continue;
                }
                const customer = await prisma.customer.findFirst({
                    where: {
                        account_id: accountId,
                        customer_number: customerNumber,
                    },
                    select: { id: true },
                });
                if (!customer) {
                    throw new Error(`Customer not found for invoice: ${customerNumber}`);
                }
                const amount = num(row.amount) ?? num(row.customer_amount) ?? 0;
                const existing = await prisma.invoice.findFirst({
                    where: {
                        account_id: accountId,
                        invoice_number: invoiceNumber,
                    },
                    select: { id: true },
                });
                const data = {
                    invoice_number: invoiceNumber,
                    account_id: accountId,
                    customer_id: customer.id,
                    amount,
                    customer_amount: num(row.customer_amount) ?? amount,
                    net_amount: num(row.net_amount) ?? amount,
                    customer_net_amount: num(row.customer_net_amount) ??
                        num(row.customer_amount) ??
                        amount,
                    currency: str(row.currency || row.customer_currency) || "USD",
                    invoice_date: row.invoice_date
                        ? new Date(String(row.invoice_date))
                        : new Date(),
                    due_date: row.due_date
                        ? new Date(String(row.due_date))
                        : null,
                    modified_by: userId || null,
                };
                const invoice = existing
                    ? await prisma.invoice.update({
                        where: { id: existing.id },
                        data: data,
                        select: { id: true },
                    })
                    : await prisma.invoice.create({
                        data: {
                            ...data,
                            created_by: userId || null,
                            status: "Open",
                        },
                        select: { id: true },
                    });
                result.success += 1;
                result.affectedCustomerIds.push(customer.id);
                result.entityIds.push(invoice.id);
            }
            catch (error) {
                result.failed += 1;
                result.errors.push(error instanceof Error ? error.message : String(error));
            }
        }
        return result;
    }
    // Payment
    for (const row of rows) {
        try {
            const invoiceNumber = str(row.invoice_number);
            const customerNumber = str(row.customer_number);
            const paymentDate = str(row.payment_date);
            const customerAmount = num(row.customer_amount) ?? num(row.amount) ?? null;
            if (!invoiceNumber || !customerNumber || !paymentDate || customerAmount == null) {
                result.skipped += 1;
                continue;
            }
            const customer = await prisma.customer.findFirst({
                where: {
                    account_id: accountId,
                    customer_number: customerNumber,
                },
                select: { id: true },
            });
            if (!customer) {
                throw new Error(`Customer not found for payment: ${customerNumber}`);
            }
            const invoice = await prisma.invoice.findFirst({
                where: {
                    account_id: accountId,
                    invoice_number: invoiceNumber,
                },
                select: { id: true },
            });
            const reference = str(row.reference) || null;
            if (reference) {
                const dup = await prisma.invoicePayment.findFirst({
                    where: {
                        account_id: accountId,
                        reference,
                        customer_id: customer.id,
                    },
                    select: { id: true },
                });
                if (dup) {
                    result.skipped += 1;
                    continue;
                }
            }
            const payment = await prisma.invoicePayment.create({
                data: {
                    account_id: accountId,
                    customer_id: customer.id,
                    invoice_id: invoice?.id ?? 0,
                    payment_date: new Date(paymentDate),
                    amount: num(row.amount) ?? customerAmount,
                    customer_amount: customerAmount,
                    customer_currency: str(row.customer_currency || row.currency) || "USD",
                    payment_method: str(row.payment_method) || null,
                    reference,
                    created_by: userId || null,
                    modified_by: userId || null,
                },
                select: { id: true },
            });
            result.success += 1;
            result.affectedCustomerIds.push(customer.id);
            result.entityIds.push(payment.id);
        }
        catch (error) {
            result.failed += 1;
            result.errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    return result;
}
async function updateAccountLastSyncDate(prisma, accountId, syncedAt = new Date()) {
    await prisma.account.update({
        where: { id: accountId },
        data: { last_sync_date: syncedAt },
    });
}
