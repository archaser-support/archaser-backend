/**
 * Imports a named set of invoices for one customer straight from the ERP and runs
 * the same follow-up chain the connector sync runs: related payments, deferred
 * payment linking, extension invoice closes, AR post-ingest and customer balances.
 *
 * The invoice-number filter is passed in memory, so connector pull_filters,
 * preview passes and sync watermarks are all left untouched.
 *
 * Usage:
 *   node scripts/development/import-invoices-for-customer.js \
 *       --customer=4036 --invoices=SI240003534,CR250000836 [--dry-run] [--user=<userId>]
 *   node scripts/development/import-invoices-for-customer.js \
 *       --customer=4036 --all [--dry-run] [--user=<userId>]
 *
 * --all pulls every Invoice and Payment for the customer's ERP CUSTNAME (no invoice list).
 * --dry-run stops before any write and prints what the ERP returned.
 * --wide-payment-filter drops the connector's stored Payment filter. Only use it when
 * you have confirmed the extra AR lines are real receipts and not invoice journal legs.
 */
require('dotenv').config();
const path = require('path');
const { PrismaClient } = require('@prisma/client');

// The connector host defaults to a packages/api layout; this repo keeps api at the root.
if (!process.env.CUSTOMERS_DOMAIN_ROOT) {
    process.env.CUSTOMERS_DOMAIN_ROOT = path.resolve(__dirname, '../../api/dist/customers');
}

const {
    importMappedEntityBatch,
    shouldSkipReportingBreachOnConnectorWrite,
} = require('./../../packages/billing-connector/dist/import/entityImporter');
const {
    applyMaturedDeferredPayments,
} = require('./../../packages/billing-connector/dist/import/applyMaturedDeferredPayments');
const {
    PriorityProviderClient,
} = require('./../../packages/billing-connector/dist/priority/PriorityProviderClient');
const {
    decryptCredentials,
} = require('./../../packages/billing-connector/dist/utils/billingConnectorCrypto');
const {
    parseMappingRules,
    mapErpRecord,
} = require('./../../packages/billing-connector/dist/utils/connectorFieldUtils');
const {
    odataSelectFieldsFromMapping,
} = require('./../../packages/billing-connector/dist/priority/prioritySelectFields');
const {
    parseEntitySetsMap,
} = require('./../../packages/billing-connector/dist/services/billingConnectorEntitySets');
const {
    resolveImportPullFilterOData,
} = require('./../../packages/billing-connector/dist/services/billingConnectorPullFilters');
const {
    getRegisteredExtension,
} = require('./../../packages/billing-connector/dist/extensions/index');
const {
    recalculateCustomerAmountsViaHost,
} = require('./../../packages/billing-connector/dist/customers/recalculateCustomerAmountsHost');

const prisma = new PrismaClient();

const LOG = '[import-invoices]';
const INVOICE_NUMBER_FIELD = 'IVNUM';
const CUSTOMER_NUMBER_FIELD = 'CUSTNAME';
/** Payment rows point at the settled invoice through FNCIREF1; IVNUM is the document itself. */
const PAYMENT_INVOICE_REF_FIELDS = ['IVNUM', 'FNCIREF1'];

function parseArgs(argv) {
    const args = {
        dryRun: false,
        widePaymentFilter: false,
        allForCustomer: false,
        customerId: null,
        invoiceNumbers: [],
        userId: undefined,
    };
    for (const raw of argv) {
        if (raw === '--dry-run') {
            args.dryRun = true;
        } else if (raw === '--all') {
            args.allForCustomer = true;
        } else if (raw === '--wide-payment-filter') {
            args.widePaymentFilter = true;
        } else if (raw.startsWith('--customer=')) {
            args.customerId = Number(raw.slice('--customer='.length));
        } else if (raw.startsWith('--invoices=')) {
            args.invoiceNumbers = raw
                .slice('--invoices='.length)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
        } else if (raw.startsWith('--user=')) {
            args.userId = raw.slice('--user='.length);
        }
    }
    return args;
}

function quoteOData(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function anyOfFilter(fields, values) {
    return fields
        .flatMap((field) => values.map((value) => `${field} eq ${quoteOData(value)}`))
        .join(' or ');
}

function andFilters(...filters) {
    const present = filters.filter((filter) => typeof filter === 'string' && filter.trim());
    if (present.length === 0) return null;
    return present.map((filter) => `(${filter})`).join(' and ');
}

async function pullAll(client, entityType, pullOptions, maxPages = 20) {
    const records = [];
    let afterKey = null;
    // Keyset paging, same as the staged sync; the targeted filter keeps this tiny.
    for (let guard = 0; guard < maxPages; guard += 1) {
        const page = await client.pull(entityType, {
            ...pullOptions,
            pagination: 'keyset',
            afterKey,
        });
        records.push(...page.records);
        if (!page.hasMore || !page.nextCursor) break;
        afterKey = page.nextCursor;
    }
    return records;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const hasInvoiceList = args.invoiceNumbers.length > 0;
    if (
        !Number.isFinite(args.customerId) ||
        (!args.allForCustomer && !hasInvoiceList) ||
        (args.allForCustomer && hasInvoiceList)
    ) {
        console.error(
            `${LOG} Usage: node scripts/development/import-invoices-for-customer.js --customer=<id> --invoices=<A,B,C> [--dry-run] [--user=<userId>]`
        );
        console.error(
            `${LOG}    or: node scripts/development/import-invoices-for-customer.js --customer=<id> --all [--dry-run] [--user=<userId>]`
        );
        process.exitCode = 1;
        return;
    }

    const customer = await prisma.customer.findUnique({
        where: { id: args.customerId },
        select: { id: true, account_id: true, customer_number: true },
    });
    if (!customer) {
        console.error(`${LOG} Customer not found:`, { customerId: args.customerId });
        process.exitCode = 1;
        return;
    }

    const connector = await prisma.billingConnector.findUnique({
        where: { account_id: customer.account_id },
    });
    if (!connector || !connector.base_url || !connector.credentials_encrypted) {
        console.error(`${LOG} No usable billing connector for account:`, {
            accountId: customer.account_id,
            hasConnector: Boolean(connector),
            hasBaseUrl: Boolean(connector?.base_url),
            hasCredentials: Boolean(connector?.credentials_encrypted),
        });
        process.exitCode = 1;
        return;
    }

    const mappings = await prisma.connectorFieldMapping.findMany({
        where: { connector_id: connector.id },
    });
    const mappingByType = new Map(mappings.map((row) => [String(row.import_type), row]));
    const invoiceMapping = mappingByType.get('Invoice');
    if (!invoiceMapping) {
        console.error(`${LOG} No Invoice field mapping configured for connector:`, {
            connectorId: connector.id,
        });
        process.exitCode = 1;
        return;
    }
    const paymentMapping = mappingByType.get('Payment');

    const entitySets = parseEntitySetsMap(connector.entity_sets);
    const extensionKey =
        typeof connector.extension_key === 'string' ? connector.extension_key.trim() : '';
    const extension = extensionKey ? getRegisteredExtension(extensionKey) : undefined;
    if (extensionKey && !extension) {
        console.error(`${LOG} Unknown extension_key on connector:`, { extensionKey });
        process.exitCode = 1;
        return;
    }
    // These are historical documents, so mirror how a backfill would have written them.
    const skipReportingBreach = shouldSkipReportingBreachOnConnectorWrite({
        syncMode: 'BACKFILL',
        skipReportingBreachOnBackfill: connector.skip_reporting_breach_on_backfill === true,
    });

    const customerFilter = `${CUSTOMER_NUMBER_FIELD} eq ${quoteOData(customer.customer_number)}`;
    const invoiceFilter = args.allForCustomer
        ? andFilters(
              resolveImportPullFilterOData(connector.pull_filters, 'Invoice'),
              customerFilter
          )
        : anyOfFilter([INVOICE_NUMBER_FIELD], args.invoiceNumbers);
    const paymentPullFilter = args.widePaymentFilter
        ? null
        : resolveImportPullFilterOData(connector.pull_filters, 'Payment');
    const maxPullPages = args.allForCustomer ? 200 : 20;

    console.log(`${LOG} Target:`, {
        customerId: customer.id,
        customerNumber: customer.customer_number,
        accountId: customer.account_id,
        connectorId: connector.id,
        provider: connector.provider,
        extensionKey: extensionKey || 'none',
        invoiceEntitySet: entitySets.Invoice ?? null,
        paymentEntitySet: entitySets.Payment ?? null,
        skipReportingBreach,
        widePaymentFilter: args.widePaymentFilter,
        invoiceCount: args.allForCustomer ? 'all (CUSTNAME filter)' : args.invoiceNumbers.length,
        allForCustomer: args.allForCustomer,
        dryRun: args.dryRun,
    });
    console.log(`${LOG} Invoice filter:`, invoiceFilter);

    const client = new PriorityProviderClient({
        baseUrl: connector.base_url,
        authType: connector.auth_type,
        credentials: decryptCredentials(connector.credentials_encrypted),
        onLog: (message) => console.log(`${LOG} [erp] ${message}`),
    });

    // Extension transforms queue invoice numbers that must be closed without a payment.
    const pendingInvoiceCloses = new Set();
    const pendingInvoiceCloseDates = new Map();

    const pullAndTransform = async (entityType, mappingRow, filter) => {
        if (!mappingRow || !filter) return [];
        const rules = parseMappingRules(mappingRow.mapping);
        const raw = await pullAll(
            client,
            entityType,
            {
                since: null,
                entitySet: entitySets[entityType] ?? null,
                filter,
                select: odataSelectFieldsFromMapping({
                    mappingRules: rules,
                    extraFields: ['UDATE'],
                    entityType,
                }),
            },
            maxPullPages
        );
        const mapped = raw.map((record) => mapErpRecord(record, rules));
        console.log(`${LOG} ${entityType} pull:`, {
            returned: raw.length,
            mapped: mapped.length,
        });
        if (!args.allForCustomer) {
            for (const record of raw) {
                console.log(`${LOG} ${entityType} ERP row:`, record);
            }
        }
        if (!extension || mapped.length === 0) return mapped;

        const transformed = await extension.transform({
            accountId: customer.account_id,
            batch: { [entityType]: mapped },
            extension_config: connector.extension_config ?? {},
            prisma: args.dryRun ? undefined : prisma,
            userId: args.userId,
            dryRun: args.dryRun,
            pendingInvoiceCloses,
            pendingInvoiceCloseDates,
        });
        const rows = transformed[entityType] ?? [];
        console.log(`${LOG} ${entityType} after extension:`, {
            kept: rows.length,
            dropped: mapped.length - rows.length,
        });
        return rows;
    };

    const invoiceRows = await pullAndTransform('Invoice', invoiceMapping, invoiceFilter);
    const pulledNumbers = [
        ...new Set(
            invoiceRows
                .map((row) => row.invoice_number)
                .filter((value) => typeof value === 'string' && value.trim())
        ),
    ];
    const missing = args.allForCustomer
        ? []
        : args.invoiceNumbers.filter((number) => !pulledNumbers.includes(number));
    if (!args.allForCustomer) {
        for (const row of invoiceRows) {
            console.log(`${LOG} Invoice mapped row:`, {
                invoiceNumber: row.invoice_number,
                customerNumber: row.customer_number,
                invoiceDate: row.invoice_date,
                dueDate: row.due_date,
                invoiceAmount: row.invoice_amount,
                baseAmount: row.base_amount,
                currency: row.currency,
                customCode1: row.custom_code1,
                creditForInvoiceNumber: row.credit_for_invoice_number ?? 'none',
            });
        }
    } else {
        console.log(`${LOG} Invoice pull summary:`, {
            mapped: invoiceRows.length,
            uniqueInvoiceNumbers: pulledNumbers.length,
        });
    }
    if (missing.length > 0) {
        console.log(`${LOG} Invoices not returned by ERP:`, missing.join(', '));
    }

    const pullPaymentsForInvoiceNumbers = async (invoiceNumbers) => {
        const paymentFilter = andFilters(
            paymentPullFilter,
            anyOfFilter(PAYMENT_INVOICE_REF_FIELDS, invoiceNumbers)
        );
        console.log(`${LOG} Payment filter (${invoiceNumbers.length} invoices):`, paymentFilter ?? 'none');
        return pullAndTransform('Payment', paymentMapping, paymentFilter);
    };

    let paymentRows = [];
    if (args.allForCustomer) {
        const batchSize = 10;
        for (let offset = 0; offset < pulledNumbers.length; offset += batchSize) {
            const batch = pulledNumbers.slice(offset, offset + batchSize);
            const batchRows = await pullPaymentsForInvoiceNumbers(batch);
            paymentRows.push(...batchRows);
            console.log(`${LOG} Payment batch:`, {
                offset,
                batchSize: batch.length,
                batchReturned: batchRows.length,
                totalPayments: paymentRows.length,
            });
        }
    } else {
        paymentRows = await pullPaymentsForInvoiceNumbers(args.invoiceNumbers);
    }
    if (!args.allForCustomer) {
        for (const row of paymentRows) {
            console.log(`${LOG} Payment mapped row:`, {
                invoiceNumber: row.invoice_number,
                reference: row.reference,
                paymentDate: row.payment_date,
                amount: row.amount,
                customerAmount: row.customer_amount,
                customerCurrency: row.customer_currency,
                paymentMethod: row.payment_method,
            });
        }
    }
    console.log(`${LOG} Extension pending closes:`, {
        virtualCloses: [...pendingInvoiceCloses].join(', ') || 'none',
    });

    if (args.dryRun) {
        console.log(`${LOG} Dry run — nothing written.`);
        return;
    }

    if (invoiceRows.length === 0) {
        console.error(`${LOG} ERP returned no invoices; aborting before write.`);
        process.exitCode = 1;
        return;
    }

    const affectedCustomerIds = new Set([customer.id]);
    const affectedInvoiceIds = new Set();
    const affectedPaymentIds = new Set();

    // 1. Invoices. Maturity is skipped here and run once below, as the sync does.
    const invoiceImport = await importMappedEntityBatch(
        prisma,
        'Invoice',
        invoiceRows,
        customer.account_id,
        null,
        args.userId,
        {
            skipReportingBreach,
            skipDeferredPaymentMaturity: true,
            extension,
            onLog: (message) => console.log(`${LOG} [invoice] ${message}`),
        }
    );
    for (const id of invoiceImport.entityIds) affectedInvoiceIds.add(id);
    for (const id of invoiceImport.affectedCustomerIds) affectedCustomerIds.add(id);
    console.log(`${LOG} Invoice import:`, {
        success: invoiceImport.success,
        failed: invoiceImport.failed,
        skipped: invoiceImport.skipped,
        entityIds: invoiceImport.entityIds.join(', '),
        errors: invoiceImport.errors.join(' | ') || 'none',
    });

    // 2. Payments for those invoices (links payments, runs extension afterPaymentLinked).
    if (paymentRows.length > 0) {
        const paymentImport = await importMappedEntityBatch(
            prisma,
            'Payment',
            paymentRows,
            customer.account_id,
            null,
            args.userId,
            {
                skipReportingBreach,
                extension,
                onLog: (message) => console.log(`${LOG} [payment] ${message}`),
            }
        );
        for (const id of paymentImport.entityIds) affectedPaymentIds.add(id);
        for (const id of paymentImport.affectedCustomerIds) affectedCustomerIds.add(id);
        console.log(`${LOG} Payment import:`, {
            success: paymentImport.success,
            failed: paymentImport.failed,
            skipped: paymentImport.skipped,
            entityIds: paymentImport.entityIds.join(', '),
            errors: paymentImport.errors.join(' | ') || 'none',
        });
    }

    // 3. Link deferred payments that were waiting for these invoice numbers.
    const maturity = await applyMaturedDeferredPayments(
        prisma,
        customer.account_id,
        new Date(),
        undefined,
        { userId: args.userId }
    );
    for (const id of maturity.affectedCustomerIds ?? []) affectedCustomerIds.add(id);
    console.log(`${LOG} Deferred payment maturity:`, {
        matured: maturity.matured,
        stillDeferred: maturity.deferredRemaining,
        totalCandidates: maturity.totalCandidates,
    });

    // 4. Settle invoices the extension marked as closed without a cash payment.
    if (
        extension?.flushPendingInvoiceCloses &&
        pendingInvoiceCloses.size > 0
    ) {
        const flushed = await extension.flushPendingInvoiceCloses({
            prisma,
            accountId: customer.account_id,
            userId: args.userId,
            invoiceNumbers: [...pendingInvoiceCloses],
            invoiceCloseDates: pendingInvoiceCloseDates,
        });
        for (const id of flushed.closedIds) affectedInvoiceIds.add(id);
        for (const id of flushed.customerIds ?? []) affectedCustomerIds.add(id);
        console.log(`${LOG} Extension invoice closes:`, {
            settled: flushed.closedIds.length,
            closedIds: flushed.closedIds.join(', ') || 'none',
        });
    }

    // 5. Insurance target dates, then the shared AR post-ingest chain.
    const invoiceIds = [...affectedInvoiceIds];
    const domain = require('./../../packages/credit-insurance-domain/dist/index');
    domain.bindCreditInsurancePrisma(prisma);
    if (invoiceIds.length > 0) {
        await domain.refreshInsuranceTargetDatesForInvoiceIds(invoiceIds);
    }

    const {
        runArPostIngestForCustomers,
    } = require('./../../packages/cron-jobs/dist/credit/arPostIngestOrchestrator');
    const postIngest = await runArPostIngestForCustomers({
        accountId: customer.account_id,
        customerIds: [...affectedCustomerIds],
        runReplay: true,
        runMaturity: false,
        runProcessOverdue: true,
        runLiveRefresh: true,
        enqueueAsOfRewrite: true,
        asOfRewrite: { importType: 'Invoice', entityIds: invoiceIds },
    });
    console.log(`${LOG} Post-ingest:`, {
        skipped: postIngest.skipped,
        skipReason: postIngest.skipReason ?? 'none',
        errorCount: postIngest.errors.length,
        errors:
            postIngest.errors.map((error) => `${error.step}: ${error.message}`).join(' | ') ||
            'none',
    });

    // 6. Customer due/overdue rollups.
    await recalculateCustomerAmountsViaHost([...affectedCustomerIds], prisma);
    console.log(`${LOG} Recalculated customer balances:`, {
        customerIds: [...affectedCustomerIds].join(', '),
    });

    const stored = await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: {
            id: true,
            invoice_number: true,
            status: true,
            amount: true,
            total_paid: true,
            outstanding_debt: true,
            customer_currency: true,
            due_date: true,
            credit_for_invoice_number: true,
            credit_for_invoice_id: true,
        },
        orderBy: { invoice_number: 'asc' },
    });
    for (const invoice of stored) {
        console.log(`${LOG} Stored invoice:`, {
            id: invoice.id,
            invoiceNumber: invoice.invoice_number,
            status: invoice.status,
            amount: invoice.amount,
            totalPaid: invoice.total_paid,
            outstandingDebt: invoice.outstanding_debt,
            currency: invoice.customer_currency,
            dueDate: invoice.due_date,
            creditForInvoiceNumber: invoice.credit_for_invoice_number ?? 'none',
            creditForInvoiceId: invoice.credit_for_invoice_id ?? 'none',
        });
    }
}

main()
    .catch((error) => {
        console.error(`${LOG} Failed:`, {
            errorMessage: error?.message,
            errorStack: error?.stack,
        });
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
