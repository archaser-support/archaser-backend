"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCustomerIdForLink = resolveCustomerIdForLink;
exports.resolveParentCustomerIdForLink = resolveParentCustomerIdForLink;
exports.getFieldLinkMetadata = getFieldLinkMetadata;
exports.attachLinkingIds = attachLinkingIds;
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value;
}
function firstRelation(row, key) {
    const raw = row[key];
    if (Array.isArray(raw)) {
        return asRecord(raw[0]);
    }
    return asRecord(raw);
}
function resolveCustomerIdForLink(row, primaryTable) {
    if (primaryTable === "Customer") {
        const id = row.id ?? row.customer_id;
        return id != null ? id : undefined;
    }
    const customer = firstRelation(row, "Customer");
    if (customer?.id != null) {
        return customer.id;
    }
    if (row.customer_id != null) {
        return row.customer_id;
    }
    if (row["Customer.id"] != null) {
        return row["Customer.id"];
    }
    return undefined;
}
function resolveParentCustomerIdForLink(row) {
    if (row.parent_customer_id != null) {
        return row.parent_customer_id;
    }
    const parent = firstRelation(row, "ParentCustomer");
    if (parent?.id != null) {
        return parent.id;
    }
    if (row["ParentCustomer.id"] != null) {
        return row["ParentCustomer.id"];
    }
    return undefined;
}
function getFieldLinkMetadata(fieldConfig, row, primaryTable, outputKey) {
    const isCustomerNameField = (fieldConfig.table === "Customer" &&
        (fieldConfig.field === "name" ||
            fieldConfig.field === "Company.name")) ||
        outputKey === "Customer.name" ||
        outputKey === "Company.name" ||
        (primaryTable === "Customer" && outputKey === "name");
    if (isCustomerNameField) {
        const customerId = resolveCustomerIdForLink(row, primaryTable);
        if (customerId != null) {
            return { type: "customer", id: customerId };
        }
    }
    const isParentCustomerNameField = (fieldConfig.table === "Customer" &&
        fieldConfig.field === "parent_customer_name") ||
        outputKey === "Customer.parent_customer_name" ||
        outputKey === "parent_customer_name";
    if (isParentCustomerNameField) {
        const parentCustomerId = resolveParentCustomerIdForLink(row);
        if (parentCustomerId != null) {
            return {
                type: "customer",
                id: parentCustomerId,
                tab: "aggregated_data",
            };
        }
    }
    const isContactNameField = (fieldConfig.table === "Contact" &&
        (fieldConfig.field === "first_name" ||
            fieldConfig.field === "last_name")) ||
        outputKey === "Contact.first_name" ||
        outputKey === "Contact.last_name" ||
        (primaryTable === "Contact" &&
            (outputKey === "first_name" || outputKey === "last_name"));
    if (isContactNameField) {
        let customerId;
        if (primaryTable === "Contact") {
            customerId =
                row.customer_id != null
                    ? row.customer_id
                    : undefined;
        }
        else {
            const contact = firstRelation(row, "Contact");
            if (contact?.customer_id != null) {
                customerId = contact.customer_id;
            }
            if (customerId == null) {
                customerId =
                    row.customer_id ??
                        row["Contact.customer_id"] ??
                        resolveCustomerIdForLink(row, primaryTable);
            }
        }
        if (customerId != null) {
            return { type: "customer", id: customerId, tab: "general" };
        }
    }
    const isDisputeNumberField = (fieldConfig.table === "Dispute" &&
        fieldConfig.field === "dispute_number") ||
        outputKey === "Dispute.dispute_number" ||
        (primaryTable === "Dispute" && outputKey === "dispute_number");
    if (isDisputeNumberField) {
        const disputeId = row.id;
        const customerId = resolveCustomerIdForLink(row, primaryTable);
        if (customerId != null && disputeId != null) {
            return {
                type: "dispute",
                id: customerId,
                tab: `outstanding-activities-tab&openDispute=${disputeId}`,
            };
        }
    }
    return null;
}
function attachLinkingIds(out, row, primaryTable, tablesInReport) {
    if (primaryTable === "Customer") {
        out.customer_id = row.id;
        const parentId = resolveParentCustomerIdForLink(row);
        if (parentId != null) {
            out.parent_customer_id = parentId;
        }
        else if (row.parent_customer_id != null) {
            out.parent_customer_id = row.parent_customer_id;
        }
        return;
    }
    if (primaryTable === "Contact" && row.customer_id != null) {
        out.customer_id = row.customer_id;
        return;
    }
    if (tablesInReport.includes("Customer") || row.customer_id != null) {
        const customerId = resolveCustomerIdForLink(row, primaryTable);
        if (customerId != null) {
            out.customer_id = customerId;
        }
    }
}
//# sourceMappingURL=report-link.util.js.map