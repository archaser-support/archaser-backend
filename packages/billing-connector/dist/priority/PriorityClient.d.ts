import type { ConnectorAuthType } from "@prisma/client";
import type { PriorityEntityImportType } from "./samplePayloads";
export interface PriorityConnectionConfig {
    baseUrl: string;
    authType: ConnectorAuthType;
    credentials: Record<string, unknown>;
}
export interface PriorityTestConnectionResult {
    ok: boolean;
    statusCode?: number;
    error?: string;
    testedAt: Date;
}
export interface PriorityFetchResult {
    ok: boolean;
    statusCode?: number;
    error?: string;
    records: Record<string, unknown>[];
}
/**
 * Lightweight connectivity check — fetches one customer row from OData.
 * Works against Priority sandbox or the local mock server.
 */
export declare function testPriorityConnection(config: PriorityConnectionConfig): Promise<PriorityTestConnectionResult>;
export declare function fetchPriorityEntitySamples(config: PriorityConnectionConfig, importType: PriorityEntityImportType, top?: number): Promise<PriorityFetchResult>;
export declare function discoverPriorityFields(config: PriorityConnectionConfig, importType: PriorityEntityImportType, top?: number): Promise<{
    ok: true;
    rawHeaders: string[];
    exampleValues: Record<string, unknown>;
    sampleCount: number;
} | {
    ok: false;
    error: string;
    statusCode?: number;
}>;
