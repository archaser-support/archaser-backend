/**
 * Report builder join graph (leaves-parity). Used by /api/reports/metadata.
 */
export type ReportRelationship = {
    from: string;
    to: string;
    fromField: string;
    toField: string;
    type: "one-to-many" | "many-to-one" | "one-to-one";
};

export const REPORT_RELATIONSHIPS: ReportRelationship[] = [
    {
        from: "Customer",
        to: "Invoice",
        fromField: "id",
        toField: "customer_id",
        type: "one-to-many",
    },
    {
        from: "Customer",
        to: "Contact",
        fromField: "id",
        toField: "customer_id",
        type: "one-to-many",
    },
    {
        from: "Customer",
        to: "Dispute",
        fromField: "id",
        toField: "customer_id",
        type: "one-to-many",
    },
    {
        from: "Customer",
        to: "Activity",
        fromField: "id",
        toField: "customer_id",
        type: "one-to-many",
    },
    {
        from: "Customer",
        to: "CustomerCollectionPeriod",
        fromField: "id",
        toField: "customer_id",
        type: "one-to-one",
    },
    {
        from: "Customer",
        to: "InvoicePayment",
        fromField: "id",
        toField: "customer_id",
        type: "one-to-many",
    },
    {
        from: "Customer",
        to: "BusinessUnit",
        fromField: "business_unit_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "Customer",
        to: "Country",
        fromField: "country_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "Customer",
        to: "State",
        fromField: "state_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "Customer",
        to: "Customer",
        fromField: "parent_customer_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "Customer",
        to: "SequenceContainer",
        fromField: "sequence_container_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "Invoice",
        to: "Customer",
        fromField: "customer_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "Invoice",
        to: "InvoicePayment",
        fromField: "id",
        toField: "invoice_id",
        type: "one-to-many",
    },
    {
        from: "Invoice",
        to: "Activity",
        fromField: "id",
        toField: "invoice_id",
        type: "one-to-many",
    },
    {
        from: "Contact",
        to: "Customer",
        fromField: "customer_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "Dispute",
        to: "Customer",
        fromField: "customer_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "Activity",
        to: "Customer",
        fromField: "customer_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "Activity",
        to: "Contact",
        fromField: "contact_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "Activity",
        to: "Invoice",
        fromField: "invoice_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "CustomerCollectionPeriod",
        to: "Customer",
        fromField: "customer_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "InvoicePayment",
        to: "Invoice",
        fromField: "invoice_id",
        toField: "id",
        type: "many-to-one",
    },
    {
        from: "InvoicePayment",
        to: "Customer",
        fromField: "customer_id",
        toField: "id",
        type: "many-to-one",
    },
];
