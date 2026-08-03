import type { ImportType } from "@prisma/client";
import { type MappingRule } from "@/server/utils/connectorFieldUtils";
export interface ConnectorFieldMappingPublic {
    import_type: ImportType;
    mapping: MappingRule[];
    is_complete: boolean;
    modified_at: string | null;
    modified_by: string | null;
}
export declare class ConnectorFieldMappingService {
    private static instance;
    static getInstance(): ConnectorFieldMappingService;
    getConnectorOrThrow(accountId: number): Promise<any>;
    listMappings(accountId: number): Promise<ConnectorFieldMappingPublic[]>;
    getMapping(accountId: number, importType: ImportType): Promise<ConnectorFieldMappingPublic | null>;
    saveMapping(accountId: number, importType: ImportType, mappingInput: unknown, userId: string): Promise<ConnectorFieldMappingPublic>;
    assertMappingsCompleteForEnabledEntities(accountId: number): Promise<void>;
    private toPublic;
}
export declare const connectorFieldMappingService: ConnectorFieldMappingService;
