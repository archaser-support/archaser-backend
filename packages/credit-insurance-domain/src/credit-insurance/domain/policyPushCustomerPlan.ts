import {
    hasPolicyPushFieldChange,
    listChangedPolicyPushFields,
    pickPolicyPushSnapshot,
    POLICY_PUSH_ALWAYS_ALIGN_FIELDS,
    type PolicyPushCustomerField,
    type PolicyPushSnapshot,
} from "./hasMeaningfulCustomerPolicyFieldChange";

export type PolicyPushCustomerRow = PolicyPushSnapshot & {
    customer_id: number;
};

export type PolicyPushCustomerPlan<Row extends PolicyPushCustomerRow> = {
    /** Push fields overlaid onto versioned customers (changed + always-align). */
    fieldsToPush: PolicyPushCustomerField[];
    /** Active rows that get a new Customer Policy version. */
    rowsToVersion: Row[];
    /** Per push field: customers that would version because they differ on it. */
    customerCountByField: Record<PolicyPushCustomerField, number>;
    uniqueCustomerCount: number;
    /** Customers that would version but are skipped (own pending Customer Policy). */
    skippedPendingCustomerCount: number;
};

function uniquePushFields(
    fields: readonly PolicyPushCustomerField[]
): PolicyPushCustomerField[] {
    const seen = new Set<PolicyPushCustomerField>();
    const out: PolicyPushCustomerField[] = [];
    for (const field of fields) {
        if (seen.has(field)) {
            continue;
        }
        seen.add(field);
        out.push(field);
    }
    return out;
}

/**
 * Decide which active Customer Policies a policy save versions: fields that
 * changed on the policy, plus {@link POLICY_PUSH_ALWAYS_ALIGN_FIELDS} (e.g.
 * registration fee), are compared/overlaid. Customers with their own pending
 * Customer Policy are skipped (counted, not versioned).
 */
export function planPolicyPushToCustomers<
    Row extends PolicyPushCustomerRow,
>(args: {
    policyBefore: PolicyPushSnapshot;
    policyAfter: PolicyPushSnapshot;
    activeRows: readonly Row[];
    pendingCustomerIds: ReadonlySet<number>;
    /**
     * Extra fields to realign even when unchanged on the policy.
     * Defaults to {@link POLICY_PUSH_ALWAYS_ALIGN_FIELDS}.
     */
    alwaysAlignFields?: readonly PolicyPushCustomerField[];
}): PolicyPushCustomerPlan<Row> {
    const before = pickPolicyPushSnapshot(args.policyBefore);
    const after = pickPolicyPushSnapshot(args.policyAfter);
    const alwaysAlignFields =
        args.alwaysAlignFields ?? POLICY_PUSH_ALWAYS_ALIGN_FIELDS;
    const fieldsToPush = uniquePushFields([
        ...listChangedPolicyPushFields(before, after),
        ...alwaysAlignFields,
    ]);
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

    // Drop always-align fields nobody actually differs on (keeps confirm UI clean).
    const fieldsWithDiffs = fieldsToPush.filter(
        (field) => (customerCountByField[field] ?? 0) > 0
    );

    return {
        fieldsToPush: fieldsWithDiffs,
        rowsToVersion,
        customerCountByField: Object.fromEntries(
            fieldsWithDiffs.map((field) => [
                field,
                customerCountByField[field] ?? 0,
            ])
        ) as Record<PolicyPushCustomerField, number>,
        uniqueCustomerCount: versionedCustomers.size,
        skippedPendingCustomerCount: skippedCustomers.size,
    };
}
