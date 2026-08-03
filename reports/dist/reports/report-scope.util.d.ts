type PrismaWhere = Record<string, unknown>;
/**
 * Tenant isolation for report *definitions* (the `Report` rows themselves).
 *
 * `Report.account_id` is mandatory and system templates are seeded per account, so
 * every account owns its own `is_system` copies. Matching `is_system` or `is_public`
 * without an account filter therefore exposes every other tenant's reports.
 */
export declare function reportVisibilityWhere(accountId: number): PrismaWhere;
/**
 * Account isolation for report primary tables.
 * Contact has no account_id — scope through Company → Customer (leaves parity).
 */
export declare function buildAccountScopeWhere(primaryTable: string, accountId: number): PrismaWhere;
/** Nest owner filter onto the correct relation for the primary table. */
export declare function nestOwnerScopeWhere(primaryTable: string, ownerFilter: PrismaWhere): PrismaWhere | null;
/** Nest business-unit filter onto the correct relation for the primary table. */
export declare function nestBusinessUnitScopeWhere(primaryTable: string, buFilter: PrismaWhere): PrismaWhere | null;
export {};
