import type { ImportType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isPriorityEntityImportType } from "@/server/integrations/priority/priorityApiContract";
import { SettingsAuditLogService } from "@/server/services/SettingsAuditLogService";
import { sanitizeDataForLogging } from "@/server/utils/auditLogHelpers";
import {
    computeMappingCompleteness,
    parseMappingRules,
    type MappingRule,
} from "@/server/utils/connectorFieldUtils";
import { getImportEntityFieldCatalog } from "@/shared/constants/importEntityFields";

export interface ConnectorFieldMappingPublic {
    import_type: ImportType;
    mapping: MappingRule[];
    is_complete: boolean;
    modified_at: string | null;
    modified_by: string | null;
}

export class ConnectorFieldMappingService {
    private static instance: ConnectorFieldMappingService;

    public static getInstance(): ConnectorFieldMappingService {
        if (!ConnectorFieldMappingService.instance) {
            ConnectorFieldMappingService.instance =
                new ConnectorFieldMappingService();
        }
        return ConnectorFieldMappingService.instance;
    }

    async getConnectorOrThrow(accountId: number) {
        const connector = await prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector) {
            throw Object.assign(new Error("Billing connector is not configured"), {
                statusCode: 400,
                code: "CONNECTOR_NOT_CONFIGURED",
            });
        }
        if (!connector.credentials_encrypted) {
            throw Object.assign(
                new Error("Billing connector credentials are not configured"),
                {
                    statusCode: 400,
                    code: "CONNECTOR_NOT_CONFIGURED",
                }
            );
        }
        return connector;
    }

    async listMappings(
        accountId: number
    ): Promise<ConnectorFieldMappingPublic[]> {
        const connector = await prisma.billingConnector.findUnique({
            where: { account_id: accountId },
            include: { ConnectorFieldMapping: true },
        });
        if (!connector) {
            return [];
        }

        return connector.ConnectorFieldMapping.map((row) =>
            this.toPublic(row.import_type, row.mapping, row.is_complete, row)
        );
    }

    async getMapping(
        accountId: number,
        importType: ImportType
    ): Promise<ConnectorFieldMappingPublic | null> {
        const connector = await prisma.billingConnector.findUnique({
            where: { account_id: accountId },
            include: {
                ConnectorFieldMapping: {
                    where: { import_type: importType },
                },
            },
        });
        if (!connector) {
            return null;
        }

        const row = connector.ConnectorFieldMapping[0];
        if (!row) {
            return {
                import_type: importType,
                mapping: [],
                is_complete: false,
                modified_at: null,
                modified_by: null,
            };
        }

        return this.toPublic(
            row.import_type,
            row.mapping,
            row.is_complete,
            row
        );
    }

    async saveMapping(
        accountId: number,
        importType: ImportType,
        mappingInput: unknown,
        userId: string
    ): Promise<ConnectorFieldMappingPublic> {
        if (!isPriorityEntityImportType(importType)) {
            throw Object.assign(new Error("Unsupported import type"), {
                statusCode: 400,
                code: "INVALID_IMPORT_TYPE",
            });
        }

        const catalog = getImportEntityFieldCatalog(importType);
        if (!catalog) {
            throw Object.assign(new Error("Unsupported import type"), {
                statusCode: 400,
                code: "INVALID_IMPORT_TYPE",
            });
        }

        const connector = await this.getConnectorOrThrow(accountId);
        const rules = parseMappingRules(mappingInput);

        const allowedFields = new Set(catalog.fields);
        for (const rule of rules) {
            if (!allowedFields.has(rule.archaserField)) {
                throw Object.assign(
                    new Error(`Unknown Archaser field: ${rule.archaserField}`),
                    { statusCode: 400, code: "INVALID_MAPPING_FIELD" }
                );
            }
            if (!rule.erpField.trim()) {
                throw Object.assign(new Error("ERP field path is required"), {
                    statusCode: 400,
                    code: "INVALID_MAPPING_FIELD",
                });
            }
        }

        const isComplete = computeMappingCompleteness(importType, rules);
        const existing = await prisma.connectorFieldMapping.findUnique({
            where: {
                connector_id_import_type: {
                    connector_id: connector.id,
                    import_type: importType,
                },
            },
        });

        const saved = await prisma.connectorFieldMapping.upsert({
            where: {
                connector_id_import_type: {
                    connector_id: connector.id,
                    import_type: importType,
                },
            },
            create: {
                connector_id: connector.id,
                import_type: importType,
                mapping: rules,
                is_complete: isComplete,
                modified_by: userId,
            },
            update: {
                mapping: rules,
                is_complete: isComplete,
                modified_by: userId,
                modified_at: new Date(),
            },
        });

        const auditLog = SettingsAuditLogService.getInstance();
        const auditPayload = sanitizeDataForLogging({
            import_type: importType,
            mapping: rules,
            is_complete: isComplete,
        });

        if (existing) {
            await auditLog.logUpdate(
                "billing-connector-mapping",
                saved.id,
                userId,
                accountId,
                sanitizeDataForLogging({
                    import_type: importType,
                    mapping: parseMappingRules(existing.mapping),
                    is_complete: existing.is_complete,
                }),
                auditPayload
            );
        } else {
            await auditLog.logCreate(
                "billing-connector-mapping",
                saved.id,
                userId,
                accountId,
                auditPayload
            );
        }

        return this.toPublic(
            saved.import_type,
            saved.mapping,
            saved.is_complete,
            saved
        );
    }

    async assertMappingsCompleteForEnabledEntities(
        accountId: number
    ): Promise<void> {
        const connector = await this.getConnectorOrThrow(accountId);
        const enabledEntities = Array.isArray(connector.enabled_entities)
            ? (connector.enabled_entities as ImportType[])
            : [];

        const mappings = await prisma.connectorFieldMapping.findMany({
            where: {
                connector_id: connector.id,
                import_type: { in: enabledEntities },
            },
        });

        const mappingByType = new Map(
            mappings.map((row) => [row.import_type, row])
        );

        const incomplete = enabledEntities.filter((entityType) => {
            const row = mappingByType.get(entityType);
            return !row?.is_complete;
        });

        if (incomplete.length > 0) {
            throw Object.assign(
                new Error(
                    `Mapping incomplete for enabled entities: ${incomplete.join(", ")}`
                ),
                { statusCode: 422, code: "MAPPING_INCOMPLETE" }
            );
        }
    }

    private toPublic(
        importType: ImportType,
        mapping: unknown,
        isComplete: boolean,
        row?: { modified_at?: Date; modified_by?: string | null }
    ): ConnectorFieldMappingPublic {
        return {
            import_type: importType,
            mapping: parseMappingRules(mapping),
            is_complete: isComplete,
            modified_at: row?.modified_at?.toISOString() ?? null,
            modified_by: row?.modified_by ?? null,
        };
    }
}

export const connectorFieldMappingService =
    ConnectorFieldMappingService.getInstance();
