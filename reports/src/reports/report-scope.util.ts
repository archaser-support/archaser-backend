type PrismaWhere = Record<string, unknown>;

/**
 * Tenant isolation for report *definitions* (the `Report` rows themselves).
 *
 * `Report.account_id` is mandatory and system templates are seeded per account, so
 * every account owns its own `is_system` copies. Matching `is_system` or `is_public`
 * without an account filter therefore exposes every other tenant's reports.
 */
export function reportVisibilityWhere(accountId: number): PrismaWhere {
    return { account_id: accountId };
}

/**
 * Account isolation for report primary tables.
 * Contact has no account_id — scope through Company → Customer (leaves parity).
 */
export function buildAccountScopeWhere(
    primaryTable: string,
    accountId: number
): PrismaWhere {
    if (primaryTable === "Contact") {
        return {
            Company: {
                Customer: {
                    some: { account_id: accountId },
                },
            },
        };
    }
    if (
        primaryTable === "Dispute" ||
        primaryTable === "CustomerCollectionPeriod"
    ) {
        return { Customer: { account_id: accountId } };
    }
    if (primaryTable === "InvoicePayment") {
        return { Invoice: { account_id: accountId } };
    }
    // Customer, Invoice, Activity, and other account-owned models
    return { account_id: accountId };
}

/** Nest owner filter onto the correct relation for the primary table. */
export function nestOwnerScopeWhere(
    primaryTable: string,
    ownerFilter: PrismaWhere
): PrismaWhere | null {
    if (!ownerFilter || Object.keys(ownerFilter).length === 0) {
        return null;
    }
    if (
        primaryTable === "Customer" ||
        primaryTable === "Invoice"
    ) {
        return ownerFilter;
    }
    if (primaryTable === "Contact") {
        return {
            Company: {
                Customer: {
                    some: ownerFilter,
                },
            },
        };
    }
    if (
        primaryTable === "Dispute" ||
        primaryTable === "CustomerCollectionPeriod"
    ) {
        return { Customer: ownerFilter };
    }
    if (primaryTable === "Activity") {
        return { Customer: ownerFilter };
    }
    if (primaryTable === "CustomerBanks") {
        return { Customer: ownerFilter };
    }
    return null;
}

/** Nest business-unit filter onto the correct relation for the primary table. */
export function nestBusinessUnitScopeWhere(
    primaryTable: string,
    buFilter: PrismaWhere
): PrismaWhere | null {
    if (!buFilter || Object.keys(buFilter).length === 0) {
        return null;
    }
    if (primaryTable === "Customer" || primaryTable === "Invoice") {
        return buFilter;
    }
    if (primaryTable === "Contact") {
        return {
            Company: {
                Customer: {
                    some: buFilter,
                },
            },
        };
    }
    if (
        primaryTable === "Dispute" ||
        primaryTable === "CustomerCollectionPeriod" ||
        primaryTable === "Activity" ||
        primaryTable === "CustomerBanks"
    ) {
        return { Customer: buFilter };
    }
    if (primaryTable === "InvoicePayment") {
        return { Invoice: { Customer: buFilter } };
    }
    return null;
}
