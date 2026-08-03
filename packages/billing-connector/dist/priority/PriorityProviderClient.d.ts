import type { ImportType } from "@prisma/client";
import { ConnectorFeature, type BillingProviderClient, type PullOptions, type PullPage, type SourceField } from "../billing/BillingProviderClient";
import { type PriorityConnectionConfig } from "./PriorityClient";
export declare class PriorityProviderClient implements BillingProviderClient {
    private readonly config;
    constructor(config: PriorityConnectionConfig);
    supportsFeature(feature: ConnectorFeature): boolean;
    testConnection(): Promise<void>;
    discoverFields(entity: ImportType): Promise<SourceField[]>;
    pull(entity: ImportType, options: PullOptions): Promise<PullPage>;
    private fetchJson;
}
