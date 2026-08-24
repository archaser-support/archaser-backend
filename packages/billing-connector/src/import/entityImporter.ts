import type { PrismaClient } from "@prisma/client";
import {
    mapErpRecord,
    parseMappingRules,
    type MappingRule,
} from "../utils/connectorFieldUtils";
import { applyMaturedDeferredPayments } from "./applyMaturedDeferredPayments";
import { importPayments } from "./importPaymentService";
import { normalizeInvoiceImportInput } from "./normalizeInvoiceImportInput";
import { toPaymentInput } from "./normalizePaymentInput";
import { sortInvoicesForImport } from "./sortInvoicesForImport";
import { linkOrphanedCreditNotes } from "../invoice/linkOrphanedCreditNotes";

export type ImportEntityType = "Customer" | "Contact" | "Invoice" | "Payment";

export interface EntityImportBatchResult {
    success: number;
    failed: number;
    skipped: number;
    affectedCustomerIds: number[];
    entityIds: number[];
    errors: string[];
}

export interface EntityImportBatchOptions {
    skipReportingBreach?: boolean;
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

function num(value: unknown): number | null {
    if (value == null || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
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
    const result: EntityImportBatchResult = {
        success: 0,
        failed: 0,
        skipped: 0,
        affectedCustomerIds: [],
        entityIds: [],
        errors: [],
    };

    const normalized = rows.map((row) =>
        normalizeInvoiceImportInput(row, accountId)
    );
    const sorted = sortInvoicesForImport(
        normalized.map((inv) => ({
            ...inv,
            customer_number: inv.customer_number,
            invoice_number: inv.invoice_number,
            invoice_date: inv.invoice_date,
        }))
    );

    const invoiceNumbersWithPayments = await getInvoiceNumbersWithPayments(
        prisma,
        accountId,
        sorted.map((i) => i.invoice_number).filter(Boolean)
    );

    for (const invoice of sorted) {
        try {
            const invoiceNumber = str(invoice.invoice_number);
            const customerNumber = str(invoice.customer_number);
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
                throw new Error(
                    `Customer not found for invoice: ${customerNumber}`
                );
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
                customer_amount: customerAmount,
                net_amount: netAmount,
                customer_net_amount: customerNetAmount,
                currency,
                customer_currency: currency,
                total_paid: totalPaid,
                customer_total_paid: customerTotalPaid,
                outstanding_debt: outstanding,
                customer_outstanding_debt: customerOutstanding,
                credit_for_invoice_number:
                    invoice.credit_for_invoice_number ?? null,
                priority_erp_debit: invoice.priority_erp_debit ?? null,
                ...(options?.skipReportingBreach === true
                    ? { reporting_breach: false }
                    : {}),
                invoice_date: invoice.invoice_date
                    ? new Date(invoice.invoice_date)
                    : new Date(),
                due_date: invoice.due_date
                    ? new Date(invoice.due_date)
                    : null,
                modified_by: userId || null,
            };

            const saved = existing
                ? await prisma.invoice.update({
                      where: { id: existing.id },
                      data: data as never,
                      select: { id: true },
                  })
                : await prisma.invoice.create({
                      data: {
                          ...data,
                          created_by: userId || null,
                          status: (invoice.status as never) ?? "Open",
                      } as never,
                      select: { id: true },
                  });

            result.success += 1;
            result.affectedCustomerIds.push(customer.id);
            result.entityIds.push(saved.id);
        } catch (error) {
            result.failed += 1;
            result.errors.push(
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    const invoiceNumbers = sorted.flatMap((i) =>
        [i.invoice_number, i.credit_for_invoice_number].filter(
            (n): n is string => Boolean(n)
        )
    );
    if (invoiceNumbers.length > 0) {
        try {
            await linkOrphanedCreditNotes(prisma, {
                accountId,
                targetInvoiceNumbers: invoiceNumbers,
            });
        } catch (error) {
            console.error("Failed to link orphaned credit notes:", error);
        }
        try {
            await applyMaturedDeferredPayments(prisma, accountId, new Date());
        } catch (error) {
            console.error("Failed to apply matured deferred payments:", error);
        }
    }

    return result;
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
                          } as never,
                          select: { id: true },
                      });
                result.success += 1;
                result.affectedCustomerIds.push(customer.id);
            } catch (error) {
                result.failed += 1;
                result.errors.push(
                    error instanceof Error ? error.message : String(error)
                );
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
                    throw new Error(
                        `Customer not found for contact: ${customerNumber}`
                    );
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
                        data: data as never,
                    });
                } else {
                    await prisma.contact.create({
                        data: {
                            ...data,
                            created_by: userId || null,
                        } as never,
                    });
                }
                result.success += 1;
                result.affectedCustomerIds.push(customer.id);
            } catch (error) {
                result.failed += 1;
                result.errors.push(
                    error instanceof Error ? error.message : String(error)
                );
            }
        }
        return result;
    }

    if (importType === "Invoice") {
        return importInvoiceBatch(prisma, rows, accountId, userId, options);
    }

    const payments = rows.map((row) => toPaymentInput(row, accountId));
    const paymentResults = await importPayments(
        prisma,
        payments,
        accountId,
        userId
    );

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

    return result;
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
