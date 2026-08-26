import type { PrismaClient } from "@prisma/client";
import {
    mapErpRecord,
    parseMappingRules,
    type MappingRule,
} from "../utils/connectorFieldUtils";
import { applyMaturedDeferredPayments } from "./applyMaturedDeferredPayments";
import { commitOps, lastWinsByKey } from "./bulkWrite";
import { importPayments } from "./importPaymentService";
import { normalizeInvoiceImportInput } from "./normalizeInvoiceImportInput";
import { toPaymentInput } from "./normalizePaymentInput";
import { sortInvoicesForImport } from "./sortInvoicesForImport";
import { linkOrphanedCreditNotes } from "../invoice/linkOrphanedCreditNotes";
import type { BillingAccountExtension } from "../extensions/types";

export type ImportEntityType = "Customer" | "Contact" | "Invoice" | "Payment";

export interface EntityImportRowResult {
    index: number;
    success: boolean;
    skipped?: boolean;
    error?: string;
    entityId?: number;
    customerId?: number;
}

export interface EntityImportBatchResult {
    success: number;
    failed: number;
    skipped: number;
    affectedCustomerIds: number[];
    entityIds: number[];
    errors: string[];
    cancelled?: boolean;
    rowResults?: EntityImportRowResult[];
}

export interface EntityImportBatchOptions {
    skipReportingBreach?: boolean;
    onLog?: (message: string) => void;
    shouldCancel?: () => boolean;
    extension?: BillingAccountExtension;
}

export function shouldSkipReportingBreachOnConnectorWrite(params: {
    syncMode: "BACKFILL" | "INCREMENTAL" | "backfill" | "incremental";
    skipReportingBreachOnBackfill: boolean;
}): boolean {
    const mode = String(params.syncMode).toUpperCase();
    return mode === "BACKFILL" && params.skipReportingBreachOnBackfill === true;
}

export function extractMaxUpdatedAt(
    records: Record<string, unknown>[]
): Date | null {
    let max: Date | null = null;
    for (const record of records) {
        const rawParent = record._rawRecord;
        const rawRecord =
            rawParent && typeof rawParent === "object" && !Array.isArray(rawParent)
                ? (rawParent as Record<string, unknown>)
                : undefined;
        const raw =
            record.UDATE ??
            record.udate ??
            record.updated_at ??
            rawRecord?.UDATE ??
            rawRecord?.udate ??
            rawRecord?.updated_at;
        if (!raw) continue;
        const parsed = new Date(String(raw));
        if (Number.isNaN(parsed.getTime())) continue;
        if (!max || parsed > max) max = parsed;
    }
    return max;
}

function str(value: unknown, fallback = ""): string {
    if (value == null) return fallback;
    return String(value).trim();
}

function emptyBatchResult(): EntityImportBatchResult {
    return {
        success: 0,
        failed: 0,
        skipped: 0,
        affectedCustomerIds: [],
        entityIds: [],
        errors: [],
        rowResults: [],
    };
}

function markCancelled(
    result: EntityImportBatchResult,
    options?: EntityImportBatchOptions
): EntityImportBatchResult {
    if (options?.shouldCancel?.()) {
        result.cancelled = true;
    }
    return result;
}

async function importCustomerBatch(
    prisma: PrismaClient,
    rows: Record<string, unknown>[],
    accountId: number,
    userId?: string,
    options?: EntityImportBatchOptions
): Promise<EntityImportBatchResult> {
    const result = emptyBatchResult();
    const rowResults: EntityImportRowResult[] = rows.map((_, index) => ({
        index,
        success: false,
    }));

    const prepared = rows.map((row, index) => ({
        index,
        customerNumber: str(row.customer_number),
        name: str(row.name) || str(row.customer_number),
        countryIso2: str(row.country_iso2 || row.country || "IL"),
        customerType:
            str(row.type).toLowerCase() === "person" ? "Person" : "Company",
        city: str(row.city) || null,
        address_line1: str(row.address_line1) || null,
        address_line2: str(row.address_line2) || null,
        postal_code: str(row.postal_code) || null,
        crn: str(row.crn) || null,
    }));

    for (const row of prepared) {
        if (!row.customerNumber) {
            result.skipped += 1;
            rowResults[row.index] = {
                index: row.index,
                success: false,
                skipped: true,
            };
        }
    }

    const valid = prepared.filter((row) => row.customerNumber);
    const winners = lastWinsByKey(valid, (row) => row.customerNumber);
    const countryCodes = [...new Set(winners.map((row) => row.countryIso2))];
    const customerNumbers = winners.map((row) => row.customerNumber);

    const [countries, existingCustomers] = await Promise.all([
        countryCodes.length === 0
            ? Promise.resolve([])
            : prisma.country.findMany({
                  where: { iso2: { in: countryCodes } },
                  select: { id: true, iso2: true },
              }),
        customerNumbers.length === 0
            ? Promise.resolve([])
            : prisma.customer.findMany({
                  where: {
                      account_id: accountId,
                      customer_number: { in: customerNumbers },
                  },
                  select: { id: true, customer_number: true, company_id: true },
              }),
    ]);

    const countryByIso2 = new Map<string, number>();
    for (const country of countries) {
        if (country.iso2) countryByIso2.set(country.iso2, country.id);
    }
    const existingByNumber = new Map<
        string,
        { id: number; company_id: number | null }
    >();
    for (const customer of existingCustomers) {
        if (customer.customer_number) {
            existingByNumber.set(customer.customer_number, {
                id: customer.id,
                company_id: customer.company_id,
            });
        }
    }

    const now = new Date();
    const companyUpdates: Array<{ id: number; name: string }> = [];
    const newCompanyNames: string[] = [];
    const ready: Array<{
        row: (typeof winners)[0];
        countryId: number;
        existingId: number | null;
        existingCompanyId: number | null;
        newCompanyIndex: number | null;
    }> = [];

    for (const row of winners) {
        const countryId = countryByIso2.get(row.countryIso2);
        if (countryId == null) {
            const message = `Unknown country iso2: ${row.countryIso2}`;
            result.failed += 1;
            result.errors.push(message);
            for (const original of valid) {
                if (original.customerNumber === row.customerNumber) {
                    rowResults[original.index] = {
                        index: original.index,
                        success: false,
                        error: message,
                    };
                }
            }
            continue;
        }
        const existing = existingByNumber.get(row.customerNumber);
        if (existing?.company_id) {
            companyUpdates.push({ id: existing.company_id, name: row.name });
            ready.push({
                row,
                countryId,
                existingId: existing.id,
                existingCompanyId: existing.company_id,
                newCompanyIndex: null,
            });
        } else {
            ready.push({
                row,
                countryId,
                existingId: existing?.id ?? null,
                existingCompanyId: null,
                newCompanyIndex: newCompanyNames.length,
            });
            newCompanyNames.push(row.name);
        }
    }

    if (companyUpdates.length > 0) {
        await commitOps(
            prisma,
            companyUpdates.map((company) =>
                prisma.company.update({
                    where: { id: company.id },
                    data: {
                        name: company.name,
                        modified_by: userId || null,
                        modified_at: now,
                    },
                })
            )
        );
    }

    const createdCompanies =
        newCompanyNames.length === 0
            ? []
            : await prisma.company.createManyAndReturn({
                  data: newCompanyNames.map((name) => ({
                      name,
                      modified_by: userId || null,
                      modified_at: now,
                      created_by: userId || null,
                  })),
                  select: { id: true },
              });

    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: number; data: Record<string, unknown> }> = [];

    for (const item of ready) {
        const companyId =
            item.existingCompanyId ??
            (item.newCompanyIndex != null
                ? createdCompanies[item.newCompanyIndex]?.id
                : null);
        if (companyId == null) {
            result.failed += 1;
            result.errors.push(
                `Failed to resolve company for ${item.row.customerNumber}`
            );
            continue;
        }
        const data = {
            customer_number: item.row.customerNumber,
            account_id: accountId,
            country_id: item.countryId,
            city: item.row.city,
            address_line1: item.row.address_line1,
            address_line2: item.row.address_line2,
            postal_code: item.row.postal_code,
            crn: item.row.crn,
            type: item.row.customerType as "Company" | "Person",
            company_id: companyId,
            modified_by: userId || null,
        };
        if (item.existingId != null) {
            updates.push({ id: item.existingId, data });
        } else {
            inserts.push({ ...data, created_by: userId || null });
        }
    }

    if (inserts.length > 0) {
        await prisma.customer.createMany({ data: inserts as never });
    }
    const createdCustomers =
        inserts.length === 0
            ? []
            : await prisma.customer.findMany({
                  where: {
                      account_id: accountId,
                      customer_number: {
                          in: inserts.map((row) => String(row.customer_number)),
                      },
                  },
                  select: { id: true, customer_number: true },
              });
    const createdByNumber = new Map<string, number>();
    for (const customer of createdCustomers) {
        if (customer.customer_number) {
            createdByNumber.set(customer.customer_number, customer.id);
        }
    }
    if (updates.length > 0) {
        await commitOps(
            prisma,
            updates.map((row) =>
                prisma.customer.update({
                    where: { id: row.id },
                    data: row.data as never,
                    select: { id: true },
                })
            )
        );
    }

    for (const item of ready) {
        const entityId =
            item.existingId ?? createdByNumber.get(item.row.customerNumber);
        result.success += 1;
        if (entityId != null) {
            result.affectedCustomerIds.push(entityId);
            result.entityIds.push(entityId);
        }
        for (const original of valid) {
            if (original.customerNumber === item.row.customerNumber) {
                rowResults[original.index] = {
                    index: original.index,
                    success: true,
                    entityId: entityId ?? undefined,
                    customerId: entityId ?? undefined,
                };
            }
        }
    }

    options?.onLog?.(
        `Customer import: ${inserts.length} created, ${updates.length} updated, ${result.failed} failed, ${result.skipped} skipped`
    );
    result.rowResults = rowResults;
    return markCancelled(result, options);
}

async function importContactBatch(
    prisma: PrismaClient,
    rows: Record<string, unknown>[],
    accountId: number,
    userId?: string,
    options?: EntityImportBatchOptions
): Promise<EntityImportBatchResult> {
    const result = emptyBatchResult();
    const rowResults: EntityImportRowResult[] = rows.map((_, index) => ({
        index,
        success: false,
    }));

    const prepared = rows.map((row, index) => ({
        index,
        customerNumber: str(row.customer_number),
        firstName: str(row.first_name),
        lastName: str(row.last_name) || null,
        email: str(row.email) || null,
        phone: str(row.phone) || null,
        mobile: str(row.mobile) || null,
        erpContactId: str(row.erp_contact_id) || null,
    }));

    for (const row of prepared) {
        if (!row.customerNumber || !row.firstName) {
            result.skipped += 1;
            rowResults[row.index] = {
                index: row.index,
                success: false,
                skipped: true,
            };
        }
    }

    const valid = prepared.filter(
        (row) => row.customerNumber && row.firstName
    );
    const winners = lastWinsByKey(valid, (row) =>
        row.erpContactId
            ? `${row.customerNumber}::erp::${row.erpContactId}`
            : `${row.customerNumber}::email::${row.email ?? row.index}`
    );

    const customerNumbers = [
        ...new Set(winners.map((row) => row.customerNumber)),
    ];
    const customers =
        customerNumbers.length === 0
            ? []
            : await prisma.customer.findMany({
                  where: {
                      account_id: accountId,
                      customer_number: { in: customerNumbers },
                  },
                  select: { id: true, customer_number: true, company_id: true },
              });
    const customerByNumber = new Map<
        string,
        { id: number; company_id: number | null }
    >();
    for (const customer of customers) {
        if (customer.customer_number) {
            customerByNumber.set(customer.customer_number, {
                id: customer.id,
                company_id: customer.company_id,
            });
        }
    }

    const customerIds = [...new Set([...customerByNumber.values()].map((c) => c.id))];
    const erpIds = winners
        .map((row) => row.erpContactId)
        .filter((id): id is string => Boolean(id));
    const emails = winners
        .map((row) => row.email)
        .filter((email): email is string => Boolean(email));

    const existingContacts =
        customerIds.length === 0 || (erpIds.length === 0 && emails.length === 0)
            ? []
            : await prisma.contact.findMany({
                  where: {
                      customer_id: { in: customerIds },
                      OR: [
                          ...(erpIds.length > 0
                              ? [{ erp_contact_id: { in: erpIds } }]
                              : []),
                          ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
                      ],
                  },
                  select: {
                      id: true,
                      customer_id: true,
                      erp_contact_id: true,
                      email: true,
                  },
              });

    const existingByErp = new Map<string, number>();
    const existingByEmail = new Map<string, number>();
    for (const contact of existingContacts) {
        if (contact.customer_id != null && contact.erp_contact_id) {
            existingByErp.set(
                `${contact.customer_id}::${contact.erp_contact_id}`,
                contact.id
            );
        }
        if (contact.customer_id != null && contact.email) {
            existingByEmail.set(
                `${contact.customer_id}::${contact.email}`,
                contact.id
            );
        }
    }

    const now = new Date();
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
    const ready: Array<{
        customerId: number;
        existingId: number | null;
        matchKey: string;
    }> = [];

    for (const row of winners) {
        const customer = customerByNumber.get(row.customerNumber);
        if (!customer) {
            const message = `Customer not found for contact: ${row.customerNumber}`;
            result.failed += 1;
            result.errors.push(message);
            for (const original of valid) {
                if (original.customerNumber === row.customerNumber) {
                    rowResults[original.index] = {
                        index: original.index,
                        success: false,
                        error: message,
                    };
                }
            }
            continue;
        }
        const existingId = row.erpContactId
            ? existingByErp.get(`${customer.id}::${row.erpContactId}`) ?? null
            : row.email
              ? existingByEmail.get(`${customer.id}::${row.email}`) ?? null
              : null;
        const data = {
            first_name: row.firstName,
            last_name: row.lastName,
            email: row.email,
            phone: row.phone,
            mobile: row.mobile,
            erp_contact_id: row.erpContactId,
            customer_id: customer.id,
            ...(customer.company_id != null
                ? { company_id: customer.company_id }
                : {}),
            modified_by: userId || null,
            modified_at: now,
        };
        const matchKey = row.erpContactId
            ? `${row.customerNumber}::erp::${row.erpContactId}`
            : `${row.customerNumber}::email::${row.email ?? row.index}`;
        if (existingId != null) {
            updates.push({ id: existingId, data });
        } else {
            inserts.push({ ...data, created_by: userId || null });
        }
        ready.push({ customerId: customer.id, existingId, matchKey });
    }

    if (inserts.length > 0) {
        await prisma.contact.createMany({ data: inserts as never });
    }
    if (updates.length > 0) {
        await commitOps(
            prisma,
            updates.map((row) =>
                prisma.contact.update({
                    where: { id: row.id },
                    data: row.data as never,
                    select: { id: true },
                })
            )
        );
    }

    const createdContacts =
        inserts.length === 0 || (erpIds.length === 0 && emails.length === 0)
            ? []
            : await prisma.contact.findMany({
                  where: {
                      customer_id: { in: customerIds },
                      OR: [
                          ...(erpIds.length > 0
                              ? [{ erp_contact_id: { in: erpIds } }]
                              : []),
                          ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
                      ],
                  },
                  select: {
                      id: true,
                      customer_id: true,
                      erp_contact_id: true,
                      email: true,
                  },
              });

    for (const item of ready) {
        const entityId =
            item.existingId ??
            createdContacts.find((contact) => {
                if (item.matchKey.includes("::erp::")) {
                    const erpId = item.matchKey.split("::erp::")[1];
                    return (
                        contact.customer_id === item.customerId &&
                        contact.erp_contact_id === erpId
                    );
                }
                const email = item.matchKey.split("::email::")[1];
                return (
                    contact.customer_id === item.customerId &&
                    contact.email === email
                );
            })?.id;
        result.success += 1;
        result.affectedCustomerIds.push(item.customerId);
        if (entityId != null) {
            result.entityIds.push(entityId);
        }
        for (const original of valid) {
            const originalKey = original.erpContactId
                ? `${original.customerNumber}::erp::${original.erpContactId}`
                : `${original.customerNumber}::email::${original.email ?? original.index}`;
            if (originalKey === item.matchKey) {
                rowResults[original.index] = {
                    index: original.index,
                    success: true,
                    entityId: entityId ?? undefined,
                    customerId: item.customerId,
                };
            }
        }
    }

    options?.onLog?.(
        `Contact import: ${inserts.length} created, ${updates.length} updated, ${result.failed} failed, ${result.skipped} skipped`
    );
    result.rowResults = rowResults;
    return markCancelled(result, options);
}

function mapRows(
    records: Record<string, unknown>[],
    mappingJson: unknown
): Record<string, unknown>[] {
    const rules: MappingRule[] = parseMappingRules(mappingJson);
    return records.map((record) => mapErpRecord(record, rules));
}

async function getInvoiceNumbersWithPayments(
    prisma: PrismaClient,
    accountId: number,
    invoiceNumbers: string[]
): Promise<Set<string>> {
    if (invoiceNumbers.length === 0) return new Set();

    const rows = await prisma.invoicePayment.findMany({
        where: {
            account_id: accountId,
            invoice_number: { in: invoiceNumbers },
        },
        select: { invoice_number: true },
    });

    return new Set(
        rows
            .map((r: { invoice_number: string | null }) => r.invoice_number)
            .filter((n): n is string => Boolean(n))
    );
}

async function importInvoiceBatch(
    prisma: PrismaClient,
    rows: Record<string, unknown>[],
    accountId: number,
    userId?: string,
    options?: EntityImportBatchOptions
): Promise<EntityImportBatchResult> {
    const result = emptyBatchResult();
    const rowResults: EntityImportRowResult[] = rows.map((_, index) => ({
        index,
        success: false,
    }));

    const normalized = rows.map((row, index) => ({
        index,
        ...normalizeInvoiceImportInput(row, accountId),
    }));

    for (const invoice of normalized) {
        const invoiceNumber = str(invoice.invoice_number);
        const customerNumber = str(invoice.customer_number);
        if (!invoiceNumber || !customerNumber) {
            result.skipped += 1;
            rowResults[invoice.index] = {
                index: invoice.index,
                success: false,
                skipped: true,
                error: "missing invoice_number or customer_number",
            };
        }
    }

    const valid = normalized.filter(
        (invoice) =>
            str(invoice.invoice_number) && str(invoice.customer_number)
    );
    const winners = lastWinsByKey(valid, (invoice) =>
        str(invoice.invoice_number)
    );
    const sorted = sortInvoicesForImport(winners);

    const customerNumbers = [
        ...new Set(sorted.map((invoice) => str(invoice.customer_number))),
    ];
    const invoiceNumbers = sorted.map((invoice) => str(invoice.invoice_number));

    const [customers, existingInvoices, invoiceNumbersWithPayments] =
        await Promise.all([
            customerNumbers.length === 0
                ? Promise.resolve([])
                : prisma.customer.findMany({
                      where: {
                          account_id: accountId,
                          customer_number: { in: customerNumbers },
                      },
                      select: { id: true, customer_number: true },
                  }),
            invoiceNumbers.length === 0
                ? Promise.resolve([])
                : prisma.invoice.findMany({
                      where: {
                          account_id: accountId,
                          invoice_number: { in: invoiceNumbers },
                      },
                      select: { id: true, invoice_number: true },
                  }),
            getInvoiceNumbersWithPayments(prisma, accountId, invoiceNumbers),
        ]);

    const customerByNumber = new Map<string, number>();
    for (const customer of customers) {
        if (customer.customer_number) {
            customerByNumber.set(customer.customer_number, customer.id);
        }
    }
    const existingByNumber = new Map<string, number>();
    for (const invoice of existingInvoices) {
        if (invoice.invoice_number) {
            existingByNumber.set(invoice.invoice_number, invoice.id);
        }
    }

    const now = new Date();
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
    const prepared: Array<{
        invoiceNumber: string;
        customerId: number;
        existingId: number | null;
    }> = [];

    for (const invoice of sorted) {
        const invoiceNumber = str(invoice.invoice_number);
        const customerNumber = str(invoice.customer_number);
        const customerId = customerByNumber.get(customerNumber);
        if (customerId == null) {
            const message = `Customer not found for invoice: ${customerNumber}`;
            result.failed += 1;
            result.errors.push(message);
            options?.onLog?.(`Invoice ${invoiceNumber} failed: ${message}`);
            for (const row of valid) {
                if (str(row.invoice_number) === invoiceNumber) {
                    rowResults[row.index] = {
                        index: row.index,
                        success: false,
                        error: message,
                    };
                }
            }
            continue;
        }

        const amount = invoice.amount ?? 0;
        const customerAmount = invoice.customer_amount ?? amount;
        const currency = str(invoice.customer_currency) || "USD";
        const paymentsWin = invoiceNumbersWithPayments.has(invoiceNumber);
        const totalPaid = paymentsWin ? 0 : (invoice.total_paid ?? 0);
        const customerTotalPaid = paymentsWin
            ? 0
            : (invoice.customer_total_paid ?? 0);
        const netAmount = customerAmount;
        const customerNetAmount = customerAmount;
        const outstanding = netAmount - totalPaid;
        const customerOutstanding = customerNetAmount - customerTotalPaid;
        const existingId = existingByNumber.get(invoiceNumber) ?? null;

        const data = {
            invoice_number: invoiceNumber,
            account_id: accountId,
            customer_id: customerId,
            amount,
            customer_amount: customerAmount,
            net_amount: netAmount,
            customer_net_amount: customerNetAmount,
            customer_currency: currency,
            total_paid: totalPaid,
            customer_total_paid: customerTotalPaid,
            outstanding_debt: outstanding,
            customer_outstanding_debt: customerOutstanding,
            credit_for_invoice_number:
                invoice.credit_for_invoice_number ?? null,
            custom_code1: invoice.custom_code1 ?? null,
            ...(options?.skipReportingBreach === true
                ? { reporting_breach: false }
                : {}),
            invoice_date: invoice.invoice_date
                ? new Date(invoice.invoice_date)
                : now,
            due_date: invoice.due_date ? new Date(invoice.due_date) : null,
            modified_by: userId || null,
            modified_at: now,
        };

        if (existingId != null) {
            updates.push({ id: existingId, data });
        } else {
            inserts.push({
                ...data,
                created_by: userId || null,
                status: (invoice.status as never) ?? "Open",
            });
        }
        prepared.push({ invoiceNumber, customerId, existingId });
    }

    if (inserts.length > 0) {
        await prisma.invoice.createMany({ data: inserts as never });
    }
    const createdRows =
        inserts.length === 0
            ? []
            : await prisma.invoice.findMany({
                  where: {
                      account_id: accountId,
                      invoice_number: {
                          in: inserts.map((row) => String(row.invoice_number)),
                      },
                  },
                  select: { id: true, invoice_number: true },
              });
    const createdByNumber = new Map<string, number>();
    for (const row of createdRows) {
        if (row.invoice_number) {
            createdByNumber.set(row.invoice_number, row.id);
        }
    }

    if (updates.length > 0) {
        await commitOps(
            prisma,
            updates.map((row) =>
                prisma.invoice.update({
                    where: { id: row.id },
                    data: row.data as never,
                    select: { id: true },
                })
            )
        );
    }

    for (const item of prepared) {
        const entityId =
            item.existingId ?? createdByNumber.get(item.invoiceNumber) ?? undefined;
        result.success += 1;
        result.affectedCustomerIds.push(item.customerId);
        if (entityId != null) {
            result.entityIds.push(entityId);
        }
        for (const row of valid) {
            if (str(row.invoice_number) === item.invoiceNumber) {
                rowResults[row.index] = {
                    index: row.index,
                    success: true,
                    entityId,
                    customerId: item.customerId,
                };
            }
        }
    }

    options?.onLog?.(
        `Invoice import: ${inserts.length} created, ${updates.length} updated, ${result.failed} failed, ${result.skipped} skipped`
    );

    const followUpNumbers = sorted.flatMap((invoice) =>
        [invoice.invoice_number, invoice.credit_for_invoice_number].filter(
            (n): n is string => Boolean(n)
        )
    );
    if (followUpNumbers.length > 0) {
        try {
            await linkOrphanedCreditNotes(prisma, {
                accountId,
                targetInvoiceNumbers: followUpNumbers,
            });
        } catch (error) {
            console.error("Failed to link orphaned credit notes:", error);
        }
    }
    const importedNumbers = prepared.map((item) => item.invoiceNumber);
    if (importedNumbers.length > 0) {
        try {
            await applyMaturedDeferredPayments(
                prisma,
                accountId,
                new Date(),
                importedNumbers
            );
        } catch (error) {
            console.error("Failed to apply matured deferred payments:", error);
        }
    }

    result.rowResults = rowResults;
    return markCancelled(result, options);
}

/**
 * Prisma-native entity upsert for connector sync and manual import.
 */
export async function importMappedEntityBatch(
    prisma: PrismaClient,
    importType: ImportEntityType,
    records: Record<string, unknown>[],
    accountId: number,
    mappingJson: unknown,
    userId?: string,
    options?: EntityImportBatchOptions
): Promise<EntityImportBatchResult> {
    const result: EntityImportBatchResult = {
        success: 0,
        failed: 0,
        skipped: 0,
        affectedCustomerIds: [],
        entityIds: [],
        errors: [],
    };
    const rows =
        mappingJson == null ? records : mapRows(records, mappingJson);
    if (rows.length === 0) return result;

    if (importType === "Customer") {
        return importCustomerBatch(prisma, rows, accountId, userId, options);
    }

    if (importType === "Contact") {
        return importContactBatch(prisma, rows, accountId, userId, options);
    }

    if (importType === "Invoice") {
        return importInvoiceBatch(prisma, rows, accountId, userId, options);
    }

    const payments = rows.map((row) => toPaymentInput(row, accountId));
    const paymentResults = await importPayments(
        prisma,
        payments,
        accountId,
        userId,
        { extension: options?.extension }
    );

    result.rowResults = paymentResults.map((paymentResult) => ({
        index: paymentResult.index,
        success: paymentResult.success,
        skipped: paymentResult.skipped,
        error: paymentResult.success ? undefined : paymentResult.message,
        entityId: paymentResult.invoicePaymentId,
        customerId: paymentResult.customerId,
    }));

    for (const paymentResult of paymentResults) {
        if (paymentResult.skipped) {
            result.skipped += 1;
            if (paymentResult.invoicePaymentId != null) {
                result.entityIds.push(paymentResult.invoicePaymentId);
            }
            if (paymentResult.customerId != null) {
                result.affectedCustomerIds.push(paymentResult.customerId);
            }
        } else if (paymentResult.success) {
            result.success += 1;
            if (paymentResult.invoicePaymentId != null) {
                result.entityIds.push(paymentResult.invoicePaymentId);
            }
            if (paymentResult.customerId != null) {
                result.affectedCustomerIds.push(paymentResult.customerId);
            }
        } else {
            result.failed += 1;
            if (paymentResult.message) {
                result.errors.push(paymentResult.message);
            }
        }
    }

    options?.onLog?.(
        `Payment import: ${result.success} saved, ${result.failed} failed, ${result.skipped} skipped`
    );
    return markCancelled(result, options);
}

export async function updateAccountLastSyncDate(
    prisma: PrismaClient,
    accountId: number,
    syncedAt: Date = new Date()
): Promise<void> {
    await prisma.account.update({
        where: { id: accountId },
        data: { last_sync_date: syncedAt },
    });
}
