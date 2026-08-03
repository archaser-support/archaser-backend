import type { ImportType } from "@prisma/client";

export enum ConnectorFeature {
    DELETED_RECORDS = "DELETED_RECORDS",
    TOTAL_COUNT = "TOTAL_COUNT",
    DATE_WINDOW = "DATE_WINDOW",
    TOKEN_REFRESH = "TOKEN_REFRESH",
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
    pageSize?: number;
    overlapMinutes?: number;
}

export interface BillingProviderClient {
    testConnection(): Promise<void>;
    discoverFields(entity: ImportType): Promise<SourceField[]>;
    pull(entity: ImportType, options: PullOptions): Promise<PullPage>;
    supportsFeature(feature: ConnectorFeature): boolean;
}
