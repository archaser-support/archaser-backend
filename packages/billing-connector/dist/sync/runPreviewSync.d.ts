import type { ImportType, PrismaClient } from "@prisma/client";
export interface PreviewEntityResult {
    import_type: ImportType;
    pulled: number;
    match_count: number;
    match_count_capped: boolean;
    sample_rows: Record<string, unknown>[];
    validation_errors: string[];
    sorted_preview: boolean;
    pull_phases: string[];
    effective_filter: string | null;
}
export interface PreviewSyncResult {
    mode: "preview";
    started_at: string;
    completed_at: string;
    cutover: {
        backfill_start_date: string | null;
        include_older_open_invoices: boolean;
        skip_reporting_breach_on_backfill: boolean;
    };
    cutover_summary: string | null;
    entities: PreviewEntityResult[];
    go_no_go: {
        required_field_errors: number;
        passed: boolean;
        checks: Array<{
            id: string;
            label: string;
            passed: boolean;
            detail: string;
        }>;
    };
}
export declare function runPreviewSync(params: {
    prisma: PrismaClient;
    accountId: number;
    importType?: ImportType;
}): Promise<PreviewSyncResult>;
export declare function discoverConnectorFields(params: {
    prisma: PrismaClient;
    accountId: number;
    importType: ImportType;
    userId?: string;
}): Promise<{
    import_type: ImportType;
    raw_headers: string[];
    example_values: Record<string, unknown>;
    sample_count: number;
    discovered_at: string | null;
    archaser_fields: string[];
    required_fields: string[];
    highlighted_fields: string[];
}>;
