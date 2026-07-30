type PrismaWhere = Record<string, unknown>;
export declare function reportVisibilityWhere(accountId: number): PrismaWhere;
export declare function buildAccountScopeWhere(primaryTable: string, accountId: number): PrismaWhere;
export declare function nestOwnerScopeWhere(primaryTable: string, ownerFilter: PrismaWhere): PrismaWhere | null;
export declare function nestBusinessUnitScopeWhere(primaryTable: string, buFilter: PrismaWhere): PrismaWhere | null;
export {};
