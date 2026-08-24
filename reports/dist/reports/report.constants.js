"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RELATION_FROM_PRIMARY = exports.CREDIT_DASHBOARD_CONTEXTS = exports.OPERATION_DASHBOARD_CONTEXTS = exports.FINANCIAL_DASHBOARD_CONTEXTS = exports.DASHBOARD_REPORT_CONTEXTS = exports.ENTITY_LIST_REPORT_CONTEXTS = exports.CONTEXT_PRIMARY_TABLE = exports.MODEL_NAME_MAP = void 0;
exports.getFieldOutputKey = getFieldOutputKey;
/** Report metadata table name → Prisma client delegate key. */
exports.MODEL_NAME_MAP = {
    Customer: "customer",
    Invoice: "invoice",
    Payment: "payment",
    InvoicePayment: "invoicePayment",
    Contact: "contact",
    Activity: "activity",
    Dispute: "customerDispute",
    CustomerCollectionPeriod: "customerCollectionPeriod",
    CustomerBanks: "customerBanks",
    AccountBankAccounts: "accountBankAccounts",
    Person: "person",
    Company: "company",
    User: "user",
    BusinessUnit: "businessUnit",
};
/** Context → primary report table for entity-list execute. */
exports.CONTEXT_PRIMARY_TABLE = {
    customers: "Customer",
    invoices: "Invoice",
    contacts: "Contact",
    customer_contacts: "Contact",
    customer_banks: "CustomerBanks",
    customer_unpaid_invoices: "Invoice",
    disputes: "Dispute",
    payments: "Payment",
    activities: "Activity",
    "customer-collection-period": "CustomerCollectionPeriod",
    dashboard_customers: "Customer",
    dashboard_invoices: "Invoice",
    dashboard_payments: "InvoicePayment",
    dashboard_activities: "Activity",
    dashboard_disputes: "Dispute",
    dashboard_promises: "CustomerCollectionPeriod",
    dashboard_credit_customers: "Customer",
    dashboard_credit_invoices: "Invoice",
};
/**
 * Embedded entity grids (customer detail tabs, etc.) that must execute without
 * requiring the global `view_reports` permission.
 */
exports.ENTITY_LIST_REPORT_CONTEXTS = new Set([
    "customers",
    "invoices",
    "contacts",
    "customer_contacts",
    "customer_banks",
    "customer_unpaid_invoices",
    "disputes",
    "payments",
    "activities",
    "customer-collection-period",
]);
exports.DASHBOARD_REPORT_CONTEXTS = new Set([
    "dashboard_invoices",
    "dashboard_customers",
    "dashboard_payments",
    "dashboard_activities",
    "dashboard_disputes",
    "dashboard_promises",
    "dashboard_credit_customers",
    "dashboard_credit_invoices",
]);
exports.FINANCIAL_DASHBOARD_CONTEXTS = new Set([
    "dashboard_invoices",
    "dashboard_customers",
    "dashboard_payments",
]);
exports.OPERATION_DASHBOARD_CONTEXTS = new Set([
    "dashboard_activities",
    "dashboard_disputes",
    "dashboard_promises",
]);
exports.CREDIT_DASHBOARD_CONTEXTS = new Set([
    "dashboard_credit_customers",
    "dashboard_credit_invoices",
]);
/** Prisma relation name on primary model for nested table fields. */
exports.RELATION_FROM_PRIMARY = {
    Customer: {
        BusinessUnit: "BusinessUnit",
        User: "Owner",
        Owner: "Owner",
        CustomerCollectionPeriod: "CustomerCollectionPeriod",
        Company: "Company",
        Person: "Person",
        Country: "Country",
        State: "State",
        ParentCustomer: "ParentCustomer",
    },
    Invoice: {
        Customer: "Customer",
        BusinessUnit: "BusinessUnit",
        User: "User",
        InsurancePolicy: "InsurancePolicy",
    },
    Contact: {
        Customer: "Customer",
        Person: "Person",
        Country: "Country",
        State: "State",
        Company: "Company",
    },
    CustomerBanks: {
        AccountBankAccounts: "AccountBankAccounts",
        Customer: "Customer",
    },
    Dispute: {
        Customer: "Customer",
        Invoice: "Invoice",
        DisputeReason: "DisputeReason",
        User: "User_CustomerDispute_owner_idToUser",
        Owner: "User_CustomerDispute_owner_idToUser",
    },
    Activity: {
        Customer: "Customer",
        Invoice: "Invoice",
        Contact: "Contact",
    },
    CustomerCollectionPeriod: {
        Customer: "Customer",
    },
    Payment: {
        Customer: "Customer",
        Invoice: "Invoice",
    },
    InvoicePayment: {
        Invoice: "Invoice",
        Payment: "Payment",
        Customer: "Customer",
    },
};
function getFieldOutputKey(field) {
    if (field.alias) {
        return field.alias;
    }
    if (field.aggregation) {
        return `${field.table}.${field.field}__${field.aggregation}`;
    }
    return `${field.table}.${field.field}`;
}
