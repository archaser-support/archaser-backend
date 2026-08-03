/**
 * Leaves-parity link metadata for report grid cells.
 * UI (viewColumnGenerator) expects `__link_<key>` = `{ type, id, tab? }`.
 */

export type ReportLinkMetadata = {
    type: string;
    id: number | string;
    tab?: string;
};

export type ReportFieldRef = {
    table: string;
    field: string;
    alias?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function firstRelation(
    row: Record<string, unknown>,
    key: string
): Record<string, unknown> | null {
    const raw = row[key];
    if (Array.isArray(raw)) {
        return asRecord(raw[0]);
    }
    return asRecord(raw);
}

export function resolveCustomerIdForLink(
    row: Record<string, unknown>,
    primaryTable: string
): number | string | undefined {
    if (primaryTable === "Customer") {
        const id = row.id ?? row.customer_id;
        return id != null ? (id as number | string) : undefined;
    }

    const customer = firstRelation(row, "Customer");
    if (customer?.id != null) {
        return customer.id as number | string;
    }
    if (row.customer_id != null) {
        return row.customer_id as number | string;
    }
    if (row["Customer.id"] != null) {
        return row["Customer.id"] as number | string;
    }
    return undefined;
}

export function resolveParentCustomerIdForLink(
    row: Record<string, unknown>
): number | string | undefined {
    if (row.parent_customer_id != null) {
        return row.parent_customer_id as number | string;
    }
    const parent = firstRelation(row, "ParentCustomer");
    if (parent?.id != null) {
        return parent.id as number | string;
    }
    if (row["ParentCustomer.id"] != null) {
        return row["ParentCustomer.id"] as number | string;
    }
    return undefined;
}

/**
 * Decide whether a report field cell should be clickable, matching leaves
 * ReportExecutionService.getFieldLinkMetadata.
 */
export function getFieldLinkMetadata(
    fieldConfig: ReportFieldRef,
    row: Record<string, unknown>,
    primaryTable: string,
    outputKey: string
): ReportLinkMetadata | null {
    const isCustomerNameField =
        (fieldConfig.table === "Customer" &&
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

    const isParentCustomerNameField =
        (fieldConfig.table === "Customer" &&
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

    const isContactNameField =
        (fieldConfig.table === "Contact" &&
            (fieldConfig.field === "first_name" ||
                fieldConfig.field === "last_name")) ||
        outputKey === "Contact.first_name" ||
        outputKey === "Contact.last_name" ||
        (primaryTable === "Contact" &&
            (outputKey === "first_name" || outputKey === "last_name"));

    if (isContactNameField) {
        let customerId: number | string | undefined;
        if (primaryTable === "Contact") {
            customerId =
                row.customer_id != null
                    ? (row.customer_id as number | string)
                    : undefined;
        } else {
            const contact = firstRelation(row, "Contact");
            if (contact?.customer_id != null) {
                customerId = contact.customer_id as number | string;
            }
            if (customerId == null) {
                customerId =
                    (row.customer_id as number | string | undefined) ??
                    (row["Contact.customer_id"] as
                        | number
                        | string
                        | undefined) ??
                    resolveCustomerIdForLink(row, primaryTable);
            }
        }
        if (customerId != null) {
            return { type: "customer", id: customerId, tab: "general" };
        }
    }

    const isDisputeNumberField =
        (fieldConfig.table === "Dispute" &&
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

/** Flat linking FKs always attached to formatted rows (leaves parity). */
export function attachLinkingIds(
    out: Record<string, unknown>,
    row: Record<string, unknown>,
    primaryTable: string,
    tablesInReport: string[]
): void {
    if (primaryTable === "Customer") {
        out.customer_id = row.id;
        const parentId = resolveParentCustomerIdForLink(row);
        if (parentId != null) {
            out.parent_customer_id = parentId;
        } else if (row.parent_customer_id != null) {
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
