/**
 * Priority OData sample payloads for mapper tests and the local mock server.
 * Field names follow Priority Developer Portal conventions; pilot must confirm
 * via GetMetadataFor(entity=...) against the target environment.
 */

import type { ImportType } from "@prisma/client";

export type PriorityEntityImportType = Extract<
    ImportType,
    "Customer" | "Contact" | "Invoice" | "Payment"
>;

/** Raw Priority CUSTOMERS records (entity set CUSTOMERS). */
export const CUSTOMER_SAMPLES = [
    {
        CUSTNAME: "T000001",
        CDES: "Acme Trading Ltd",
        CUSTDES: "Acme Trading Ltd",
        EMAIL: "billing@acme.example",
        PHONE: "+1-415-555-0100",
        STATDES: "Active",
        COUNTRYNAME: "United States",
        STATE: "CA",
        ADDRESS: "100 Market St",
        ZIP: "94105",
        WTAXNUM: "US-514123456",
        UDATE: "2025-06-01T08:15:00Z",
    },
    {
        CUSTNAME: "T000002",
        CDES: "Beta Industries",
        CUSTDES: "Beta Industries",
        EMAIL: "ap@beta.example",
        PHONE: "+1-212-555-0200",
        STATDES: "Active",
        COUNTRYNAME: "United States",
        STATE: "NY",
        ADDRESS: "200 Broadway",
        ZIP: "10007",
        WTAXNUM: "US-514987654",
        UDATE: "2025-06-10T14:30:00Z",
    },
    {
        CUSTNAME: "T000003",
        CDES: "Gamma Services",
        CUSTDES: "Gamma Services",
        EMAIL: null,
        PHONE: "+972-3-555-0300",
        STATDES: "Active",
        COUNTRYNAME: "Israel",
        STATE: null,
        ADDRESS: "12 Rothschild Blvd",
        ZIP: "6688101",
        WTAXNUM: "514111222",
        UDATE: "2025-06-15T09:00:00Z",
    },
] as const;

/** Raw Priority CUSTPERSONNEL records (customer contacts). */
export const CONTACT_SAMPLES = [
    {
        KLINE: 10001,
        CUSTNAME: "T000001",
        NAME: "Jane Smith",
        FIRSTNAME: "Jane",
        LASTNAME: "Smith",
        EMAIL: "jane.smith@acme.example",
        PHONE: "+1-415-555-0101",
        CELLPHONE: "+1-415-555-0199",
        POSITIONDES: "AP Manager",
        UDATE: "2025-06-02T11:00:00Z",
    },
    {
        KLINE: 10002,
        CUSTNAME: "T000001",
        NAME: "Bob Lee",
        FIRSTNAME: "Bob",
        LASTNAME: "Lee",
        EMAIL: "bob.lee@acme.example",
        PHONE: "+1-415-555-0102",
        CELLPHONE: null,
        POSITIONDES: "Controller",
        UDATE: "2025-06-05T16:45:00Z",
    },
    {
        KLINE: 10003,
        CUSTNAME: "T000002",
        NAME: "Maria Garcia",
        FIRSTNAME: "Maria",
        LASTNAME: "Garcia",
        EMAIL: "maria@beta.example",
        PHONE: "+1-212-555-0201",
        CELLPHONE: "+1-212-555-0299",
        POSITIONDES: "Finance",
        UDATE: "2025-06-12T10:20:00Z",
    },
] as const;

/** Raw Priority CINVOICES records (AR invoices; includes one credit note). */
export const INVOICE_SAMPLES = [
    {
        IVNUM: "INV-2025-0001",
        IVTYPE: "A",
        DEBIT: "D",
        CUSTNAME: "T000001",
        IVDATE: "2025-05-01T00:00:00Z",
        DUEDATE: "2025-06-01T00:00:00Z",
        TOTPRICE: 1500.0,
        CODE: "USD",
        STATDES: "Final",
        BOOKNUM: "SO-1001",
        UDATE: "2025-05-01T07:00:00Z",
        CREDITFOR: null,
    },
    {
        IVNUM: "INV-2025-0002",
        IVTYPE: "A",
        DEBIT: "D",
        CUSTNAME: "T000002",
        IVDATE: "2025-05-15T00:00:00Z",
        DUEDATE: "2025-06-15T00:00:00Z",
        TOTPRICE: 2270.33,
        CODE: "USD",
        STATDES: "Final",
        BOOKNUM: "SO-1002",
        UDATE: "2025-05-15T12:30:00Z",
        CREDITFOR: null,
    },
    {
        IVNUM: "CN-2025-0001",
        IVTYPE: "A",
        DEBIT: "C",
        CUSTNAME: "T000001",
        IVDATE: "2025-05-20T00:00:00Z",
        DUEDATE: "2025-05-20T00:00:00Z",
        TOTPRICE: -250.0,
        CODE: "USD",
        STATDES: "Final",
        BOOKNUM: "CN-2001",
        UDATE: "2025-05-20T09:15:00Z",
        CREDITFOR: "INV-2025-0001",
    },
] as const;

/** Raw Priority TOTARPAY records (AR payment receipts). */
export const PAYMENT_SAMPLES = [
    {
        PAYNUM: "PAY-2025-0001",
        CUSTNAME: "T000001",
        IVNUM: "INV-2025-0001",
        IVTYPE: "A",
        PAYDATE: "2025-05-25T00:00:00Z",
        PAYMENT: 1250.0,
        CODE: "USD",
        PAYMENTCODE: "1",
        PAYDES: "Wire transfer",
        UDATE: "2025-05-25T10:00:00Z",
    },
    {
        PAYNUM: "PAY-2025-0002",
        CUSTNAME: "T000002",
        IVNUM: "INV-2025-0002",
        IVTYPE: "A",
        PAYDATE: "2025-06-01T00:00:00Z",
        PAYMENT: 2270.33,
        CODE: "USD",
        PAYMENTCODE: "2",
        PAYDES: "Credit Card",
        UDATE: "2025-06-01T14:00:00Z",
    },
    {
        PAYNUM: "PAY-2025-0003",
        CUSTNAME: "T000001",
        IVNUM: "INV-2025-0001",
        IVTYPE: "A",
        PAYDATE: "2025-06-10T00:00:00Z",
        PAYMENT: 250.0,
        CODE: "USD",
        PAYMENTCODE: "1",
        PAYDES: "Wire transfer",
        UDATE: "2025-06-10T08:30:00Z",
    },
] as const;

export const SAMPLE_PAYLOADS_BY_IMPORT_TYPE: Record<
    PriorityEntityImportType,
    readonly Record<string, unknown>[]
> = {
    Customer: CUSTOMER_SAMPLES,
    Contact: CONTACT_SAMPLES,
    Invoice: INVOICE_SAMPLES,
    Payment: PAYMENT_SAMPLES,
};
