import type { ImportType } from "@prisma/client";
export declare enum ConnectorFeature {
    DELETED_RECORDS = "DELETED_RECORDS",
    TOTAL_COUNT = "TOTAL_COUNT",
    DATE_WINDOW = "DATE_WINDOW",
    TOKEN_REFRESH = "TOKEN_REFRESH"
}
export interface SourceField {
    path: string;
    example?: unknown;
}
export interface PullPage {
    records: Record<string, unknown>[];
    nextCursor: string | null;
    hasMore: boolean;
    totalCount?: number;
}
export interface PullOptions {
    since: Date | null;
    cursor?: string | null;
    /** Last $orderby key from the previous page (keyset pagination). */
    afterKey?: string | null;
    /** Default skip. Keyset avoids O(n) $skip scans on large Priority collections. */
    pagination?: "skip" | "keyset";
    pageSize?: number;
    overlapMinutes?: number;
    entitySet?: string | null;
    filter?: string | null;
    /** OData $select columns. Omit to return all form fields. */
    select?: string[] | null;
    /** Mapping pull_date_field when the admin picked one. */
    preferredDateField?: string | null;
    /** Backfill window start — client adds `{dateField} ge …` after discovering columns. */
    createdOnOrAfter?: Date | null;
}
export interface BillingProviderClient {
    testConnection(): Promise<void>;
    discoverFields(entity: ImportType): Promise<SourceField[]>;
    pull(entity: ImportType, options: PullOptions): Promise<PullPage>;
    supportsFeature(feature: ConnectorFeature): boolean;
}
