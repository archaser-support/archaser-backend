"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineOutstandingFromAggregateRow = lineOutstandingFromAggregateRow;
exports.resolveInvoiceLineOutstandingInAccountCurrency = resolveInvoiceLineOutstandingInAccountCurrency;
exports.computeInvoiceLineOpenArInAccountCurrency = computeInvoiceLineOpenArInAccountCurrency;
exports.fetchOpenReceivableByCustomerMapInAccountCurrency = fetchOpenReceivableByCustomerMapInAccountCurrency;
exports.topOpenReceivableCurrencyBuckets = topOpenReceivableCurrencyBuckets;
exports.fetchOpenReceivableForCustomerByCurrency = fetchOpenReceivableForCustomerByCurrency;
exports.resolveCustomerHeaderOpenArAmounts = resolveCustomerHeaderOpenArAmounts;
exports.fetchOpenReceivableTotalForCustomer = fetchOpenReceivableTotalForCustomer;
exports.fetchOpenReceivableForCustomer = fetchOpenReceivableForCustomer;
exports.fetchOpenReceivableCurrencyRowsForCustomer = fetchOpenReceivableCurrencyRowsForCustomer;
exports.fetchOpenReceivableByCustomerMap = fetchOpenReceivableByCustomerMap;
exports.invoiceOpenReceivableWhere = invoiceOpenReceivableWhere;
const client_1 = require("@prisma/client");
const domain_db_1 = require("../domain-db");
const invoiceBucketAmounts_1 = require("./shared/invoiceBucketAmounts");
const customerCreditInsuranceHeaderAmounts_1 = require("./customerCreditInsuranceHeaderAmounts");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
function lineOutstandingFromAggregateRow(row) {
    if (row.outstanding_debt != null && row.outstanding_debt !== 0) {
        return row.outstanding_debt;
    }
    if (row.customer_outstanding_debt != null &&
        row.customer_outstanding_debt !== 0) {
        return row.customer_outstanding_debt;
    }
    return 0;
}
async function resolveInvoiceLineOutstandingInAccountCurrency(row, accountCurrency) {
    const accountCur = accountCurrency.trim().toUpperCase();
    const custCurrency = row.customer_currency?.trim().toUpperCase();
    const hasAccountOutstanding = row.outstanding_debt != null && row.outstanding_debt !== 0;
    let converted;
    if (!hasAccountOutstanding &&
        custCurrency &&
        custCurrency !== accountCur) {
        const custOutstanding = row.customer_outstanding_debt != null
            ? Number(row.customer_outstanding_debt)
            : 0;
        const amount = row.amount != null ? Number(row.amount) : 0;
        const val = custOutstanding !== 0 ? custOutstanding : amount;
        converted = await (0, customerCreditInsuranceHeaderAmounts_1.convertAmountToCurrencyLatestRate)(custCurrency, accountCur, val);
    }
    return computeInvoiceLineOpenArInAccountCurrency(row, accountCur, converted);
}
function computeInvoiceLineOpenArInAccountCurrency(row, accountCurrency, convertedFromCustomerCurrency) {
    if (row.outstanding_debt != null && row.outstanding_debt !== 0) {
        return Number(row.outstanding_debt);
    }
    const accountCur = accountCurrency.trim().toUpperCase();
    const custCurrency = row.customer_currency?.trim().toUpperCase();
    const custOutstanding = row.customer_outstanding_debt != null
        ? Number(row.customer_outstanding_debt)
        : 0;
    const amount = row.amount != null ? Number(row.amount) : 0;
    if (custCurrency && custCurrency !== accountCur) {
        const val = custOutstanding !== 0 ? custOutstanding : amount;
        return convertedFromCustomerCurrency ?? val;
    }
    return (0, invoiceInsuranceFields_1.invoiceOutstandingInAccountCurrency)(row);
}
async function fetchOpenReceivableByCustomerMapInAccountCurrency(accountId, accountCurrency, options) {
    const db = options?.dbClient ?? domain_db_1.prisma;
    const accountCur = accountCurrency.trim().toUpperCase();
    const invoices = await db.invoice.findMany({
        where: {
            account_id: accountId,
            status: { in: ["Due", "Overdue"] },
            ...(options?.customerIds?.length
                ? { customer_id: { in: options.customerIds } }
                : {}),
            ...(options?.policyId != null ? { policy_id: options.policyId } : {}),
            Customer: {
                account_id: accountId,
                collection_status: { in: ["Active", "Inactive"] },
            },
        },
        select: {
            customer_id: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            amount: true,
            customer_currency: true,
        },
    });
    const map = new Map();
    for (const inv of invoices) {
        if (inv.customer_id == null) {
            continue;
        }
        const custCurrency = inv.customer_currency?.trim().toUpperCase();
        const hasAccountOutstanding = inv.outstanding_debt != null && inv.outstanding_debt !== 0;
        let converted;
        if (!hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur) {
            const custOutstanding = inv.customer_outstanding_debt != null
                ? Number(inv.customer_outstanding_debt)
                : 0;
            const amount = inv.amount != null ? Number(inv.amount) : 0;
            const val = custOutstanding !== 0 ? custOutstanding : amount;
            converted = await (0, customerCreditInsuranceHeaderAmounts_1.convertAmountToCurrencyLatestRate)(custCurrency, accountCur, val);
        }
        const line = computeInvoiceLineOpenArInAccountCurrency(inv, accountCur, converted);
        map.set(inv.customer_id, (map.get(inv.customer_id) ?? 0) + line);
    }
    return map;
}
function topOpenReceivableCurrencyBuckets(rows, topN = 2) {
    const byCurrency = new Map();
    for (const row of rows) {
        const currency = row.customer_currency?.trim().toUpperCase();
        if (!currency) {
            continue;
        }
        const amount = row.customer_outstanding_debt != null && row.customer_outstanding_debt !== 0
            ? row.customer_outstanding_debt
            : (row.outstanding_debt ?? 0);
        if (amount <= 0) {
            continue;
        }
        byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
    }
    return Array.from(byCurrency.entries())
        .map(([currency, openAr]) => ({ currency, openAr }))
        .sort((a, b) => b.openAr - a.openAr)
        .slice(0, topN);
}
async function fetchOpenReceivableForCustomerByCurrency(accountId, customerId, currency, policyId, dbClient = domain_db_1.prisma) {
    const code = currency.trim().toUpperCase();
    if (!code) {
        return 0;
    }
    const rows = await dbClient.$queryRaw `
        SELECT COALESCE(
            SUM(
                CASE
                    WHEN COALESCE(i.customer_outstanding_debt, 0) != 0 THEN i.customer_outstanding_debt
                    ELSE COALESCE(i.amount, 0)
                END
            ),
            0
        )::float AS ar
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND UPPER(COALESCE(i.customer_currency, '')) = ${code}
          AND i.status IN ('Due', 'Overdue')
          ${policyId != null ? client_1.Prisma.sql `AND i.policy_id = ${policyId}` : client_1.Prisma.empty}
    `;
    return Number(rows[0]?.ar ?? 0);
}
async function resolveCustomerHeaderOpenArAmounts(params) {
    const { accountId, customerId, accountCurrency, customer, dbClient } = params;
    const denormalizedTotalAr = (0, invoiceInsuranceFields_1.computeCustomerTotalAr)(customer).toNumber();
    const acct = accountCurrency?.trim();
    let total_ar = denormalizedTotalAr;
    if (acct) {
        const liveByCustomer = await fetchOpenReceivableByCustomerMapInAccountCurrency(accountId, acct, { customerIds: [customerId], dbClient });
        const livePrimary = liveByCustomer.get(customerId) ?? 0;
        if (livePrimary > 0) {
            total_ar = livePrimary;
        }
    }
    let credit_insurance_secondary_currency = null;
    let total_ar_secondary = null;
    if (acct) {
        const secondaryCurrency = (0, invoiceBucketAmounts_1.resolveCustomerCreditInsuranceSecondaryCurrency)(customer, acct);
        if (secondaryCurrency) {
            credit_insurance_secondary_currency = secondaryCurrency;
            const liveSecondary = await fetchOpenReceivableForCustomerByCurrency(accountId, customerId, secondaryCurrency, undefined, dbClient);
            total_ar_secondary =
                liveSecondary > 0
                    ? liveSecondary
                    : (0, invoiceBucketAmounts_1.resolveCustomerTotalArSecondaryFromInvoiceBuckets)(customer, secondaryCurrency);
            if (total_ar_secondary == null) {
                credit_insurance_secondary_currency = null;
            }
        }
    }
    return {
        total_ar,
        total_ar_secondary,
        credit_insurance_secondary_currency,
    };
}
async function fetchOpenReceivableTotalForCustomer(customerId, accountId, dbClient = domain_db_1.prisma) {
    const rows = await dbClient.$queryRaw `
        SELECT COALESCE(
          SUM(
            CASE
              WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
              ELSE COALESCE(i.customer_outstanding_debt, 0)
            END
          ),
          0
        )::float AS ar
        FROM "Invoice" i
        WHERE i.customer_id = ${customerId}
          AND i.account_id = ${accountId}
          AND i.status IN ('Due', 'Overdue')
    `;
    return Number(rows[0]?.ar ?? 0);
}
async function fetchOpenReceivableForCustomer(accountId, customerId, policyId, dbClient = domain_db_1.prisma) {
    const rows = await dbClient.$queryRaw `
        SELECT COALESCE(
            SUM(
                CASE
                    WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                    ELSE COALESCE(i.customer_outstanding_debt, 0)
                END
            ),
            0
        )::float AS ar
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND i.status IN ('Due', 'Overdue')
          ${policyId != null ? client_1.Prisma.sql `AND i.policy_id = ${policyId}` : client_1.Prisma.empty}
    `;
    return Number(rows[0]?.ar ?? 0);
}
async function fetchOpenReceivableCurrencyRowsForCustomer(customerId, accountId, dbClient = domain_db_1.prisma) {
    return dbClient.$queryRaw `
        SELECT
          i.customer_currency,
          COALESCE(SUM(i.outstanding_debt), 0)::float AS outstanding_debt,
          COALESCE(SUM(i.customer_outstanding_debt), 0)::float AS customer_outstanding_debt
        FROM "Invoice" i
        WHERE i.customer_id = ${customerId}
          AND i.account_id = ${accountId}
          AND i.status IN ('Due', 'Overdue')
        GROUP BY i.customer_currency
    `;
}
async function fetchOpenReceivableByCustomerMap(dbClient = domain_db_1.prisma) {
    const rows = await dbClient.$queryRaw `
        SELECT i.customer_id,
          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                ELSE COALESCE(i.customer_outstanding_debt, 0)
              END
            ),
            0
          )::float AS ar
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        INNER JOIN "Account" a ON a.id = c.account_id
        WHERE c.collection_status IN ('Active', 'Inactive')
          AND a.has_credit_insurance = true
          AND i.status IN ('Due', 'Overdue')
        GROUP BY i.customer_id
    `;
    const map = new Map();
    for (const row of rows) {
        map.set(row.customer_id, Number(row.ar ?? 0));
    }
    return map;
}
function invoiceOpenReceivableWhere(scope) {
    return {
        customer_id: scope.customerId,
        account_id: scope.accountId,
        status: { in: ["Due", "Overdue"] },
        ...(scope.policyId != null ? { policy_id: scope.policyId } : {}),
    };
}
//# sourceMappingURL=openReceivableByCustomerCurrency.js.map