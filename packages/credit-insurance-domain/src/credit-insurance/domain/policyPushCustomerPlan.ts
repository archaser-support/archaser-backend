import {
    hasPolicyPushFieldChange,
    listChangedPolicyPushFields,
    pickPolicyPushSnapshot,
    type PolicyPushCustomerField,
    type PolicyPushSnapshot,
} from "./hasMeaningfulCustomerPolicyFieldChange";

export type PolicyPushCustomerRow = PolicyPushSnapshot & {
    customer_id: number;
};

export type PolicyPushCustomerPlan<Row extends PolicyPushCustomerRow> = {
    /** Push fields that changed on the policy in this save. */
    fieldsToPush: PolicyPushCustomerField[];
    /** Active rows that get a new Customer Policy version. */
    rowsToVersion: Row[];
    /** Per changed field: customers that would version because they differ on it. */
    customerCountByField: Record<PolicyPushCustomerField, number>;
    uniqueCustomerCount: number;
    /** Customers that would version but are skipped (own pending Customer Policy). */
    skippedPendingCustomerCount: number;
};

/**
 * Decide which active Customer Policies a policy save versions: only fields
 * that changed on the policy are compared/overlaid, and customers with their
 * own pending Customer Policy are skipped (counted, not versioned).
 */
export function planPolicyPushToCustomers<
    Row extends PolicyPushCustomerRow,
>(args: {
    policyBefore: PolicyPushSnapshot;
    policyAfter: PolicyPushSnapshot;
    activeRows: readonly Row[];
    pendingCustomerIds: ReadonlySet<number>;
}): PolicyPushCustomerPlan<Row> {
    const before = pickPolicyPushSnapshot(args.policyBefore);
    const after = pickPolicyPushSnapshot(args.policyAfter);
    const fieldsToPush = listChangedPolicyPushFields(before, after);
    const customerCountByField = Object.fromEntries(
        fieldsToPush.map((field) => [field, 0])
    ) as Record<PolicyPushCustomerField, number>;

    const rowsToVersion: Row[] = [];
    const versionedCustomers = new Set<number>();
    const skippedCustomers = new Set<number>();
    const countedByField = new Map<PolicyPushCustomerField, Set<number>>(
        fieldsToPush.map((field) => [field, new Set<number>()])
    );

    for (const row of args.activeRows) {
        const customerSnap = pickPolicyPushSnapshot(row);
        const differingFields = fieldsToPush.filter((field) =>
            hasPolicyPushFieldChange(customerSnap, after, [field])
        );
        if (differingFields.length === 0) {
            continue;
        }
        if (args.pendingCustomerIds.has(row.customer_id)) {
            skippedCustomers.add(row.customer_id);
            continue;
        }
        rowsToVersion.push(row);
        versionedCustomers.add(row.customer_id);
        for (const field of differingFields) {
            countedByField.get(field)?.add(row.customer_id);
        }
    }

    for (const [field, customers] of countedByField) {
        customerCountByField[field] = customers.size;
    }

    return {
        fieldsToPush,
        rowsToVersion,
        customerCountByField,
        uniqueCustomerCount: versionedCustomers.size,
        skippedPendingCustomerCount: skippedCustomers.size,
    };
}
