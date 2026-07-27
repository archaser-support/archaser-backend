#!/usr/bin/env tsx

/**
 * Import File Generator for Stress Tests
 *
 * Generates CSV files for Customer, Invoice, Contact, and Payment imports
 * with runId-based identifiers for easy cleanup.
 */

import * as fs from "fs";
import * as path from "path";

export interface ImportFileDescriptor {
    type: "customer" | "invoice" | "contact" | "payment";
    filePath: string;
    recordCount: number;
}

export interface ImportConfig {
    recordsPerFile?: number;
    customerOverrides?: Partial<CustomerRecord>;
    invoiceOverrides?: Partial<InvoiceRecord>;
    contactOverrides?: Partial<ContactRecord>;
    paymentOverrides?: Partial<PaymentRecord>;
}

interface CustomerRecord {
    name: string;
    customer_number: string;
    country_iso2: string;
    state_iso2?: string;
    city?: string;
    address_line1?: string;
    postal_code?: string;
    owner_email?: string;
    business_unit?: string;
}

interface InvoiceRecord {
    customer_number: string;
    invoice_number: string;
    invoice_date: string;
    due_date: string;
    amount: number;
    customer_amount?: number;
    customer_total_paid?: number;
    customer_currency?: string;
    status_id?: number;
}

interface ContactRecord {
    customer_number: string;
    first_name: string;
    last_name: string;
    email?: string;
    mobile?: string;
    role?: string;
}

interface PaymentRecord {
    customer_number: string;
    invoice_number: string;
    payment_date: string;
    amount: number;
    customer_amount: number;
    customer_currency: string;
    payment_method?: string;
    reference?: string;
}

/**
 * Generate customer CSV data
 */
function generateCustomerRecords(
    count: number,
    runId: string,
    userId: string,
    index: number,
    config?: ImportConfig
): CustomerRecord[] {
    const records: CustomerRecord[] = [];
    const baseCustomerNumber = `STRESS_TEST_CUST_${runId}_${userId}_${index}`;

    for (let i = 0; i < count; i++) {
        const customerNumber = `${baseCustomerNumber}_${i + 1}`;
        records.push({
            name: `Test Customer ${i + 1}`,
            customer_number: customerNumber,
            country_iso2: "US",
            state_iso2: "CA",
            city: "San Francisco",
            address_line1: `${i + 1} Test Street`,
            postal_code: "94103",
            // Don't set owner_email - it's optional and causes validation issues if the user doesn't exist
            // owner_email: `owner${i + 1}@test.local`,
            ...config?.customerOverrides,
        });
    }

    return records;
}

/**
 * Generate invoice CSV data
 */
function generateInvoiceRecords(
    count: number,
    runId: string,
    userId: string,
    index: number,
    customerNumbers: string[],
    config?: ImportConfig
): InvoiceRecord[] {
    const records: InvoiceRecord[] = [];
    const baseInvoiceNumber = `STRESS_TEST_INV_${runId}_${userId}_${index}`;
    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 30);

    for (let i = 0; i < count; i++) {
        const invoiceNumber = `${baseInvoiceNumber}_${i + 1}`;
        const customerNumber =
            customerNumbers[i % customerNumbers.length] || customerNumbers[0];
        const amount = 1000 + Math.random() * 9000;

        records.push({
            customer_number: customerNumber,
            invoice_number: invoiceNumber,
            invoice_date: today.toISOString().split("T")[0],
            due_date: dueDate.toISOString().split("T")[0],
            amount: Math.round(amount * 100) / 100,
            customer_amount: Math.round(amount * 100) / 100,
            customer_total_paid: 0,
            customer_currency: "USD",
            status_id: 13, // DUE status (matches INVOICE_STATUS.DUE)
            ...config?.invoiceOverrides,
        });
    }

    return records;
}

/**
 * Generate contact CSV data
 */
function generateContactRecords(
    count: number,
    runId: string,
    userId: string,
    index: number,
    customerNumbers: string[],
    config?: ImportConfig
): ContactRecord[] {
    const records: ContactRecord[] = [];

    for (let i = 0; i < count; i++) {
        const customerNumber =
            customerNumbers[i % customerNumbers.length] || customerNumbers[0];

        records.push({
            customer_number: customerNumber,
            first_name: `Contact${i + 1}`,
            last_name: `Person${runId.substring(0, 8)}`,
            email: `contact${i + 1}_${runId.substring(0, 8)}@test.local`,
            mobile: `+1555${String(i + 1).padStart(7, "0")}`,
            role: "Manager",
            ...config?.contactOverrides,
        });
    }

    return records;
}

/**
 * Generate payment CSV data
 */
function generatePaymentRecords(
    count: number,
    runId: string,
    userId: string,
    index: number,
    customerNumbers: string[],
    invoiceNumbers: string[],
    config?: ImportConfig
): PaymentRecord[] {
    const records: PaymentRecord[] = [];
    const baseReference = `STRESS_TEST_PAY_${runId}_${userId}_${index}`;
    const today = new Date();

    for (let i = 0; i < count; i++) {
        const customerNumber =
            customerNumbers[i % customerNumbers.length] || customerNumbers[0];
        const invoiceNumber =
            invoiceNumbers[i % invoiceNumbers.length] || invoiceNumbers[0];
        const amount = 100 + Math.random() * 900;

        records.push({
            customer_number: customerNumber,
            invoice_number: invoiceNumber,
            payment_date: today.toISOString().split("T")[0],
            amount: Math.round(amount * 100) / 100,
            customer_amount: Math.round(amount * 100) / 100,
            customer_currency: "USD",
            payment_method: "Bank Transfer",
            reference: `${baseReference}_${i + 1}`,
            ...config?.paymentOverrides,
        });
    }

    return records;
}

/**
 * Convert records to CSV format
 */
function recordsToCSV(records: any[]): string {
    if (records.length === 0) return "";

    const headers = Object.keys(records[0]);
    const headerRow = headers.join(",");
    const dataRows = records.map((record) =>
        headers
            .map((header) => {
                const value = record[header];
                if (value === null || value === undefined) return "";
                // Escape commas and quotes in CSV
                const stringValue = String(value);
                if (
                    stringValue.includes(",") ||
                    stringValue.includes('"') ||
                    stringValue.includes("\n")
                ) {
                    return `"${stringValue.replace(/"/g, '""')}"`;
                }
                return stringValue;
            })
            .join(",")
    );

    return [headerRow, ...dataRows].join("\n");
}

/**
 * Generate import files for all types (parallelized)
 */
export async function generateImportFiles(
    runId: string,
    userId: string,
    userIndex: number,
    recordsPerFile: number = 500,
    config?: ImportConfig
): Promise<ImportFileDescriptor[]> {
    const baseDir = path.join("/tmp", "stress-test-imports", runId, userId);
    await fs.promises.mkdir(baseDir, { recursive: true });

    const descriptors: ImportFileDescriptor[] = [];

    // Generate customer records first (needed for other types)
    const customerRecords = generateCustomerRecords(
        recordsPerFile,
        runId,
        userId,
        userIndex,
        config
    );
    const customerNumbers = customerRecords.map((r) => r.customer_number);
    const customerPath = path.join(baseDir, "customers.csv");

    // Generate all other records in parallel after customers
    const [invoiceRecords, contactRecords] = await Promise.all([
        Promise.resolve(
            generateInvoiceRecords(
                recordsPerFile,
                runId,
                userId,
                userIndex,
                customerNumbers,
                config
            )
        ),
        Promise.resolve(
            generateContactRecords(
                recordsPerFile,
                runId,
                userId,
                userIndex,
                customerNumbers,
                config
            )
        ),
    ]);

    const invoiceNumbers = invoiceRecords.map((r) => r.invoice_number);
    const paymentRecords = generatePaymentRecords(
        recordsPerFile,
        runId,
        userId,
        userIndex,
        customerNumbers,
        invoiceNumbers,
        config
    );

    const invoicePath = path.join(baseDir, "invoices.csv");
    const contactPath = path.join(baseDir, "contacts.csv");
    const paymentPath = path.join(baseDir, "payments.csv");

    // Write all files in parallel
    await Promise.all([
        fs.promises.writeFile(
            customerPath,
            recordsToCSV(customerRecords),
            "utf-8"
        ),
        fs.promises.writeFile(
            invoicePath,
            recordsToCSV(invoiceRecords),
            "utf-8"
        ),
        fs.promises.writeFile(
            contactPath,
            recordsToCSV(contactRecords),
            "utf-8"
        ),
        fs.promises.writeFile(
            paymentPath,
            recordsToCSV(paymentRecords),
            "utf-8"
        ),
    ]);

    descriptors.push(
        {
            type: "customer",
            filePath: customerPath,
            recordCount: customerRecords.length,
        },
        {
            type: "invoice",
            filePath: invoicePath,
            recordCount: invoiceRecords.length,
        },
        {
            type: "contact",
            filePath: contactPath,
            recordCount: contactRecords.length,
        },
        {
            type: "payment",
            filePath: paymentPath,
            recordCount: paymentRecords.length,
        }
    );

    return descriptors;
}

// Allow running as standalone script for testing
if (require.main === module) {
    const runId = process.argv[2] || `test-${Date.now()}`;
    const userId = process.argv[3] || "test-user";
    const userIndex = parseInt(process.argv[4] || "0", 10);
    const recordsPerFile = parseInt(process.argv[5] || "10", 10);

    generateImportFiles(runId, userId, userIndex, recordsPerFile)
        .then((descriptors) => {
            console.log(`\n✅ Generated ${descriptors.length} import files:`);
            descriptors.forEach((desc) => {
                console.log(
                    `  ${desc.type}: ${desc.filePath} (${desc.recordCount} records)`
                );
            });
            process.exit(0);
        })
        .catch((error) => {
            console.error("❌ Failed to generate files:", error);
            process.exit(1);
        });
}
