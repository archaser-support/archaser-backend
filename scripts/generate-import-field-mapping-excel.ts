/**
 * Generates customer-facing Excel import field mapping guide.
 * Run: npx tsx scripts/generate-import-field-mapping-excel.ts
 */

import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";

interface ImportFieldRow {
    fieldKey: string;
    displayName: string;
    type: string;
    mandatory: "Yes" | "No";
    description: string;
    example: string;
}

const CUSTOMER_FIELDS: ImportFieldRow[] = [
    {
        fieldKey: "name",
        displayName: "Customer Name",
        type: "string",
        mandatory: "Yes",
        description: "Full name (person) or company name",
        example: "John Doe",
    },
    {
        fieldKey: "customer_number",
        displayName: "Customer Number",
        type: "string",
        mandatory: "Yes",
        description: "Unique identifier for the customer",
        example: "12345",
    },
    {
        fieldKey: "country_iso2",
        displayName: "Country",
        type: "string (2 chars)",
        mandatory: "Yes",
        description: "Two-letter country ISO code (e.g., US)",
        example: "US",
    },
    {
        fieldKey: "crn",
        displayName: "CRN",
        type: "string",
        mandatory: "No",
        description: "Company registration number (optional)",
        example: "514123456",
    },
    {
        fieldKey: "state_iso2",
        displayName: "State",
        type: "string (2 chars)",
        mandatory: "No",
        description: "Two-letter state ISO code (optional)",
        example: "CA",
    },
    {
        fieldKey: "city",
        displayName: "City",
        type: "string",
        mandatory: "No",
        description: "City name",
        example: "San Francisco",
    },
    {
        fieldKey: "address_line1",
        displayName: "Address Line 1",
        type: "string",
        mandatory: "No",
        description: "Street address line 1",
        example: "123 Main St",
    },
    {
        fieldKey: "address_line2",
        displayName: "Address Line 2",
        type: "string",
        mandatory: "No",
        description: "Street address line 2 (optional)",
        example: "Suite 400",
    },
    {
        fieldKey: "postal_code",
        displayName: "Postal Code",
        type: "string",
        mandatory: "No",
        description: "ZIP or postal code",
        example: "94103",
    },
    {
        fieldKey: "owner_email",
        displayName: "Owner Email",
        type: "string (email)",
        mandatory: "No",
        description: "Email of the owner",
        example: "john.doe@example.com",
    },
    {
        fieldKey: "business_unit",
        displayName: "Business Unit",
        type: "string",
        mandatory: "No",
        description:
            "External ID of the business unit (must exist; user needs access)",
        example: "BU-001",
    },
    {
        fieldKey: "parent_customer_number",
        displayName: "Parent Customer Number",
        type: "string",
        mandatory: "No",
        description:
            "Customer number of the parent customer (parent must already exist)",
        example: "PARENT-001",
    },
];

const CONTACT_FIELDS: ImportFieldRow[] = [
    {
        fieldKey: "first_name",
        displayName: "First Name",
        type: "string",
        mandatory: "Yes",
        description: "First name of the contact (min 2 characters)",
        example: "John",
    },
    {
        fieldKey: "last_name",
        displayName: "Last Name",
        type: "string",
        mandatory: "Yes",
        description: "Last name of the contact",
        example: "Doe",
    },
    {
        fieldKey: "customer_number",
        displayName: "Customer Number",
        type: "string",
        mandatory: "Yes",
        description: "Customer number to find customer (must already exist)",
        example: "12345",
    },
    {
        fieldKey: "email",
        displayName: "Email",
        type: "string (email)",
        mandatory: "No",
        description: "Email address",
        example: "john.doe@example.com",
    },
    {
        fieldKey: "phone",
        displayName: "Phone",
        type: "string",
        mandatory: "No",
        description: "Phone number",
        example: "+1234567890",
    },
    {
        fieldKey: "mobile",
        displayName: "Mobile",
        type: "string",
        mandatory: "No",
        description: "Mobile number",
        example: "+19876543210",
    },
    {
        fieldKey: "role",
        displayName: "Role",
        type: "string",
        mandatory: "No",
        description: "Role/title of the contact",
        example: "Manager",
    },
    {
        fieldKey: "company_wide_address",
        displayName: "Company Wide Address",
        type: "boolean",
        mandatory: "No",
        description:
            "Whether this contact receives communications for all addresses. Accepted true values: true, 1, yes, y, on, enabled, active",
        example: "false",
    },
    {
        fieldKey: "receives_standard_reminder",
        displayName: "Receives Standard Reminder",
        type: "boolean",
        mandatory: "No",
        description:
            "Whether this contact receives standard reminder communications",
        example: "true",
    },
    {
        fieldKey: "receives_escalated_reminder",
        displayName: "Receives Escalated Reminder",
        type: "boolean",
        mandatory: "No",
        description:
            "Whether this contact receives escalated reminder communications",
        example: "false",
    },
    {
        fieldKey: "generic_text1",
        displayName: "Custom Text 1",
        type: "string",
        mandatory: "No",
        description:
            "Account-specific custom field (only available if enabled in Settings)",
        example: "Example",
    },
    {
        fieldKey: "generic_text2",
        displayName: "Custom Text 2",
        type: "string",
        mandatory: "No",
        description:
            "Account-specific custom field (only available if enabled in Settings)",
        example: "Example",
    },
    {
        fieldKey: "generic_number1",
        displayName: "Custom Number 1",
        type: "number",
        mandatory: "No",
        description:
            "Account-specific custom field (only available if enabled in Settings)",
        example: "100",
    },
    {
        fieldKey: "generic_number2",
        displayName: "Custom Number 2",
        type: "number",
        mandatory: "No",
        description:
            "Account-specific custom field (only available if enabled in Settings)",
        example: "100",
    },
    {
        fieldKey: "generic_date1",
        displayName: "Custom Date 1",
        type: "date (YYYY-MM-DD)",
        mandatory: "No",
        description:
            "Account-specific custom field (only available if enabled in Settings)",
        example: "2026-02-15",
    },
    {
        fieldKey: "generic_date2",
        displayName: "Custom Date 2",
        type: "date (YYYY-MM-DD)",
        mandatory: "No",
        description:
            "Account-specific custom field (only available if enabled in Settings)",
        example: "2026-02-15",
    },
];

const INVOICE_FIELDS: ImportFieldRow[] = [
    {
        fieldKey: "customer_number",
        displayName: "Customer Number",
        type: "string",
        mandatory: "Yes",
        description: "Customer number to associate this invoice with (must exist)",
        example: "12345",
    },
    {
        fieldKey: "invoice_date",
        displayName: "Invoice Date",
        type: "date (YYYY-MM-DD)",
        mandatory: "Yes",
        description: "Date when the invoice was issued",
        example: "2024-01-15",
    },
    {
        fieldKey: "due_date",
        displayName: "Due Date",
        type: "date (YYYY-MM-DD)",
        mandatory: "Yes",
        description: "Date when payment is due",
        example: "2024-02-15",
    },
    {
        fieldKey: "invoice_number",
        displayName: "Invoice Number",
        type: "string",
        mandatory: "Yes",
        description: "Unique invoice number",
        example: "INV-2024-001",
    },
    {
        fieldKey: "base_amount",
        displayName: "Amount in Base Currency",
        type: "number",
        mandatory: "Yes",
        description:
            "Invoice amount in the account base currency (used for currency ratio calculation)",
        example: "1500.00",
    },
    {
        fieldKey: "invoice_amount",
        displayName: "Amount",
        type: "number",
        mandatory: "Yes",
        description: "Total invoice amount in customer currency",
        example: "1500.00",
    },
    {
        fieldKey: "customer_total_paid",
        displayName: "Total Paid",
        type: "number",
        mandatory: "No",
        description: "Total amount already paid by the customer (defaults to 0)",
        example: "0.00",
    },
    {
        fieldKey: "currency",
        displayName: "Currency",
        type: "string",
        mandatory: "No",
        description: "Currency code (e.g., USD, EUR)",
        example: "USD",
    },
    {
        fieldKey: "credit_for_invoice_number",
        displayName: "Credit For Invoice Number",
        type: "string",
        mandatory: "No",
        description: "The invoice number that this credit note references",
        example: "",
    },
];

const PAYMENT_FIELDS: ImportFieldRow[] = [
    {
        fieldKey: "customer_number",
        displayName: "Customer Number",
        type: "string",
        mandatory: "Yes",
        description: "Unique identifier for the customer (must exist)",
        example: "1357",
    },
    {
        fieldKey: "invoice_number",
        displayName: "Invoice Number",
        type: "string",
        mandatory: "Yes",
        description:
            "Invoice number for the payment (must exist for that customer)",
        example: "INV-2024-0001",
    },
    {
        fieldKey: "payment_date",
        displayName: "Payment Date",
        type: "date (YYYY-MM-DD)",
        mandatory: "Yes",
        description: "Date of the payment",
        example: "2024-04-01",
    },
    {
        fieldKey: "amount",
        displayName: "Amount",
        type: "number",
        mandatory: "No",
        description:
            "Payment amount in account base currency (optional). When omitted, Archaser derives it from customer_amount using the linked invoice ratio: customer_amount × (invoice base amount / invoice customer amount)",
        example: "2270.33",
    },
    {
        fieldKey: "customer_amount",
        displayName: "Customer Amount",
        type: "number",
        mandatory: "Yes",
        description: "Amount assigned to the customer",
        example: "2270.33",
    },
    {
        fieldKey: "customer_currency",
        displayName: "Currency",
        type: "string",
        mandatory: "Yes",
        description: "Currency of the payment",
        example: "USD",
    },
    {
        fieldKey: "reference",
        displayName: "Reference",
        type: "string",
        mandatory: "Yes",
        description: "Unique payment reference (required for import processing)",
        example: "PAY-1001",
    },
    {
        fieldKey: "payment_method",
        displayName: "Payment Method",
        type: "string",
        mandatory: "No",
        description: "Method of payment",
        example: "Credit Card",
    },
];

const HEADERS = [
    "Field Key",
    "Display Name",
    "Type",
    "Mandatory",
    "Description",
    "Example",
] as const;

const HEADER_FILL: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4472C4" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
    bold: true,
    color: { argb: "FFFFFFFF" },
    size: 11,
};

const MANDATORY_YES_FILL: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFCE4D6" },
};

function styleHeaderRow(sheet: ExcelJS.Worksheet): void {
    const headerRow = sheet.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
        cell.font = HEADER_FONT;
        cell.fill = HEADER_FILL;
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        cell.border = {
            bottom: { style: "thin", color: { argb: "FF2F5496" } },
        };
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function addFieldRows(sheet: ExcelJS.Worksheet, fields: ImportFieldRow[]): void {
    sheet.addRow([...HEADERS]);

    for (const field of fields) {
        const row = sheet.addRow([
            field.fieldKey,
            field.displayName,
            field.type,
            field.mandatory,
            field.description,
            field.example,
        ]);

        if (field.mandatory === "Yes") {
            row.getCell(4).fill = MANDATORY_YES_FILL;
            row.getCell(4).font = { bold: true };
        }

        row.eachCell((cell) => {
            cell.alignment = { vertical: "top", wrapText: true };
        });
    }

    styleHeaderRow(sheet);

    sheet.columns = [
        { width: 28 },
        { width: 26 },
        { width: 22 },
        { width: 12 },
        { width: 55 },
        { width: 20 },
    ];

    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: fields.length + 1, column: HEADERS.length },
    };
}

function addOverviewSheet(workbook: ExcelJS.Workbook): void {
    const sheet = workbook.addWorksheet("Overview");
    const rows: Array<[string, string]> = [
        ["Archaser Import Field Mapping Guide", ""],
        ["", ""],
        ["Supported file formats", ".csv, .xlsx, .xls"],
        ["Import location", "App → Import"],
        ["Recommended import order", "Customer → Contact → Invoice → Payment"],
        ["", ""],
        ["How to use this guide", ""],
        [
            "Field Key",
            "Use this name when mapping columns in the Import Field Mapping screen",
        ],
        [
            "Mandatory",
            "Yes = must be mapped and populated for each row; No = optional",
        ],
        [
            "Type",
            "Expected data format. Dates should be YYYY-MM-DD unless noted",
        ],
        ["", ""],
        ["Sheet: Customer", "Fields for customer/debtor import"],
        ["Sheet: Contact", "Fields for contact import (customer must exist)"],
        ["Sheet: Invoice", "Fields for invoice import (customer must exist)"],
        [
            "Sheet: Payment",
            "Fields for payment import (customer and invoice must exist)",
        ],
    ];

    for (const [colA, colB] of rows) {
        const row = sheet.addRow([colA, colB]);
        if (colA === "Archaser Import Field Mapping Guide") {
            row.getCell(1).font = { bold: true, size: 14 };
        }
        row.eachCell((cell) => {
            cell.alignment = { vertical: "top", wrapText: true };
        });
    }

    sheet.columns = [{ width: 32 }, { width: 70 }];
}

async function main(): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Archaser";
    workbook.created = new Date();

    addOverviewSheet(workbook);

    const customerSheet = workbook.addWorksheet("Customer");
    addFieldRows(customerSheet, CUSTOMER_FIELDS);

    const contactSheet = workbook.addWorksheet("Contact");
    addFieldRows(contactSheet, CONTACT_FIELDS);

    const invoiceSheet = workbook.addWorksheet("Invoice");
    addFieldRows(invoiceSheet, INVOICE_FIELDS);

    const paymentSheet = workbook.addWorksheet("Payment");
    addFieldRows(paymentSheet, PAYMENT_FIELDS);

    const outputDir = path.join(
        process.cwd(),
        "docs",
        "user-guides"
    );
    const outputPath = path.join(
        outputDir,
        "import-field-mapping-guide.xlsx"
    );

    fs.mkdirSync(outputDir, { recursive: true });
    await workbook.xlsx.writeFile(outputPath);

    console.log(`Generated: ${outputPath}`);
}

main().catch((error) => {
    console.error("Failed to generate import field mapping Excel:", error);
    process.exit(1);
});
