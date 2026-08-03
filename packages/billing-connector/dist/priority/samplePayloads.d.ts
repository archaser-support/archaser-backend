/**
 * Priority OData sample payloads for mapper tests and the local mock server.
 * Field names follow Priority Developer Portal conventions; pilot must confirm
 * via GetMetadataFor(entity=...) against the target environment.
 */
import type { ImportType } from "@prisma/client";
export type PriorityEntityImportType = Extract<ImportType, "Customer" | "Contact" | "Invoice" | "Payment">;
/** Raw Priority CUSTOMERS records (entity set CUSTOMERS). */
export declare const CUSTOMER_SAMPLES: readonly [{
    readonly CUSTNAME: "T000001";
    readonly CDES: "Acme Trading Ltd";
    readonly CUSTDES: "Acme Trading Ltd";
    readonly EMAIL: "billing@acme.example";
    readonly PHONE: "+1-415-555-0100";
    readonly STATDES: "Active";
    readonly COUNTRYNAME: "United States";
    readonly STATE: "CA";
    readonly ADDRESS: "100 Market St";
    readonly ZIP: "94105";
    readonly WTAXNUM: "US-514123456";
    readonly UDATE: "2025-06-01T08:15:00Z";
}, {
    readonly CUSTNAME: "T000002";
    readonly CDES: "Beta Industries";
    readonly CUSTDES: "Beta Industries";
    readonly EMAIL: "ap@beta.example";
    readonly PHONE: "+1-212-555-0200";
    readonly STATDES: "Active";
    readonly COUNTRYNAME: "United States";
    readonly STATE: "NY";
    readonly ADDRESS: "200 Broadway";
    readonly ZIP: "10007";
    readonly WTAXNUM: "US-514987654";
    readonly UDATE: "2025-06-10T14:30:00Z";
}, {
    readonly CUSTNAME: "T000003";
    readonly CDES: "Gamma Services";
    readonly CUSTDES: "Gamma Services";
    readonly EMAIL: null;
    readonly PHONE: "+972-3-555-0300";
    readonly STATDES: "Active";
    readonly COUNTRYNAME: "Israel";
    readonly STATE: null;
    readonly ADDRESS: "12 Rothschild Blvd";
    readonly ZIP: "6688101";
    readonly WTAXNUM: "514111222";
    readonly UDATE: "2025-06-15T09:00:00Z";
}];
/** Raw Priority CUSTPERSONNEL records (customer contacts). */
export declare const CONTACT_SAMPLES: readonly [{
    readonly KLINE: 10001;
    readonly CUSTNAME: "T000001";
    readonly NAME: "Jane Smith";
    readonly FIRSTNAME: "Jane";
    readonly LASTNAME: "Smith";
    readonly EMAIL: "jane.smith@acme.example";
    readonly PHONE: "+1-415-555-0101";
    readonly CELLPHONE: "+1-415-555-0199";
    readonly POSITIONDES: "AP Manager";
    readonly UDATE: "2025-06-02T11:00:00Z";
}, {
    readonly KLINE: 10002;
    readonly CUSTNAME: "T000001";
    readonly NAME: "Bob Lee";
    readonly FIRSTNAME: "Bob";
    readonly LASTNAME: "Lee";
    readonly EMAIL: "bob.lee@acme.example";
    readonly PHONE: "+1-415-555-0102";
    readonly CELLPHONE: null;
    readonly POSITIONDES: "Controller";
    readonly UDATE: "2025-06-05T16:45:00Z";
}, {
    readonly KLINE: 10003;
    readonly CUSTNAME: "T000002";
    readonly NAME: "Maria Garcia";
    readonly FIRSTNAME: "Maria";
    readonly LASTNAME: "Garcia";
    readonly EMAIL: "maria@beta.example";
    readonly PHONE: "+1-212-555-0201";
    readonly CELLPHONE: "+1-212-555-0299";
    readonly POSITIONDES: "Finance";
    readonly UDATE: "2025-06-12T10:20:00Z";
}];
/** Raw Priority CINVOICES records (AR invoices; includes one credit note). */
export declare const INVOICE_SAMPLES: readonly [{
    readonly IVNUM: "INV-2025-0001";
    readonly IVTYPE: "A";
    readonly DEBIT: "D";
    readonly CUSTNAME: "T000001";
    readonly IVDATE: "2025-05-01T00:00:00Z";
    readonly DUEDATE: "2025-06-01T00:00:00Z";
    readonly TOTPRICE: 1500;
    readonly CODE: "USD";
    readonly STATDES: "Final";
    readonly BOOKNUM: "SO-1001";
    readonly UDATE: "2025-05-01T07:00:00Z";
    readonly CREDITFOR: null;
}, {
    readonly IVNUM: "INV-2025-0002";
    readonly IVTYPE: "A";
    readonly DEBIT: "D";
    readonly CUSTNAME: "T000002";
    readonly IVDATE: "2025-05-15T00:00:00Z";
    readonly DUEDATE: "2025-06-15T00:00:00Z";
    readonly TOTPRICE: 2270.33;
    readonly CODE: "USD";
    readonly STATDES: "Final";
    readonly BOOKNUM: "SO-1002";
    readonly UDATE: "2025-05-15T12:30:00Z";
    readonly CREDITFOR: null;
}, {
    readonly IVNUM: "CN-2025-0001";
    readonly IVTYPE: "A";
    readonly DEBIT: "C";
    readonly CUSTNAME: "T000001";
    readonly IVDATE: "2025-05-20T00:00:00Z";
    readonly DUEDATE: "2025-05-20T00:00:00Z";
    readonly TOTPRICE: -250;
    readonly CODE: "USD";
    readonly STATDES: "Final";
    readonly BOOKNUM: "CN-2001";
    readonly UDATE: "2025-05-20T09:15:00Z";
    readonly CREDITFOR: "INV-2025-0001";
}];
/** Raw Priority TOTARPAY records (AR payment receipts). */
export declare const PAYMENT_SAMPLES: readonly [{
    readonly PAYNUM: "PAY-2025-0001";
    readonly CUSTNAME: "T000001";
    readonly IVNUM: "INV-2025-0001";
    readonly IVTYPE: "A";
    readonly PAYDATE: "2025-05-25T00:00:00Z";
    readonly PAYMENT: 1250;
    readonly CODE: "USD";
    readonly PAYMENTCODE: "1";
    readonly PAYDES: "Wire transfer";
    readonly UDATE: "2025-05-25T10:00:00Z";
}, {
    readonly PAYNUM: "PAY-2025-0002";
    readonly CUSTNAME: "T000002";
    readonly IVNUM: "INV-2025-0002";
    readonly IVTYPE: "A";
    readonly PAYDATE: "2025-06-01T00:00:00Z";
    readonly PAYMENT: 2270.33;
    readonly CODE: "USD";
    readonly PAYMENTCODE: "2";
    readonly PAYDES: "Credit Card";
    readonly UDATE: "2025-06-01T14:00:00Z";
}, {
    readonly PAYNUM: "PAY-2025-0003";
    readonly CUSTNAME: "T000001";
    readonly IVNUM: "INV-2025-0001";
    readonly IVTYPE: "A";
    readonly PAYDATE: "2025-06-10T00:00:00Z";
    readonly PAYMENT: 250;
    readonly CODE: "USD";
    readonly PAYMENTCODE: "1";
    readonly PAYDES: "Wire transfer";
    readonly UDATE: "2025-06-10T08:30:00Z";
}];
export declare const SAMPLE_PAYLOADS_BY_IMPORT_TYPE: Record<PriorityEntityImportType, readonly Record<string, unknown>[]>;
