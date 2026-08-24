/** Report metadata table name → Prisma client delegate key. */
export const MODEL_NAME_MAP: Record<string, string> = {
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
export const CONTEXT_PRIMARY_TABLE: Record<string, string> = {
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
export const ENTITY_LIST_REPORT_CONTEXTS = new Set([
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

export const DASHBOARD_REPORT_CONTEXTS = new Set([
    "dashboard_invoices",
    "dashboard_customers",
    "dashboard_payments",
    "dashboard_activities",
    "dashboard_disputes",
    "dashboard_promises",
    "dashboard_credit_customers",
    "dashboard_credit_invoices",
]);

export const FINANCIAL_DASHBOARD_CONTEXTS = new Set([
    "dashboard_invoices",
    "dashboard_customers",
    "dashboard_payments",
]);

export const OPERATION_DASHBOARD_CONTEXTS = new Set([
    "dashboard_activities",
    "dashboard_disputes",
    "dashboard_promises",
]);

export const CREDIT_DASHBOARD_CONTEXTS = new Set([
    "dashboard_credit_customers",
    "dashboard_credit_invoices",
]);

/** Prisma relation name on primary model for nested table fields. */
export const RELATION_FROM_PRIMARY: Record<
    string,
    Record<string, string>
> = {
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

export function getFieldOutputKey(field: {
    table: string;
    field: string;
    alias?: string;
    aggregation?: string;
}): string {
    if (field.alias) {
        return field.alias;
    }
    if (field.aggregation) {
        return `${field.table}.${field.field}__${field.aggregation}`;
    }
    return `${field.table}.${field.field}`;
}
