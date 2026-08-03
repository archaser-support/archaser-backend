"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectorFieldMappingService = exports.ConnectorFieldMappingService = void 0;
const prisma_1 = require("@/lib/prisma");
const priorityApiContract_1 = require("@/server/integrations/priority/priorityApiContract");
const SettingsAuditLogService_1 = require("@/server/services/SettingsAuditLogService");
const auditLogHelpers_1 = require("@/server/utils/auditLogHelpers");
const connectorFieldUtils_1 = require("@/server/utils/connectorFieldUtils");
const importEntityFields_1 = require("@/shared/constants/importEntityFields");
class ConnectorFieldMappingService {
    static getInstance() {
        if (!ConnectorFieldMappingService.instance) {
            ConnectorFieldMappingService.instance =
                new ConnectorFieldMappingService();
        }
        return ConnectorFieldMappingService.instance;
    }
    async getConnectorOrThrow(accountId) {
        const connector = await prisma_1.prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector) {
            throw Object.assign(new Error("Billing connector is not configured"), {
                statusCode: 400,
                code: "CONNECTOR_NOT_CONFIGURED",
            });
        }
        if (!connector.credentials_encrypted) {
            throw Object.assign(new Error("Billing connector credentials are not configured"), {
                statusCode: 400,
                code: "CONNECTOR_NOT_CONFIGURED",
            });
        }
        return connector;
    }
    async listMappings(accountId) {
        const connector = await prisma_1.prisma.billingConnector.findUnique({
            where: { account_id: accountId },
            include: { ConnectorFieldMapping: true },
        });
        if (!connector) {
            return [];
        }
        return connector.ConnectorFieldMapping.map((row) => this.toPublic(row.import_type, row.mapping, row.is_complete, row));
    }
    async getMapping(accountId, importType) {
        const connector = await prisma_1.prisma.billingConnector.findUnique({
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
        return this.toPublic(row.import_type, row.mapping, row.is_complete, row);
    }
    async saveMapping(accountId, importType, mappingInput, userId) {
        if (!(0, priorityApiContract_1.isPriorityEntityImportType)(importType)) {
            throw Object.assign(new Error("Unsupported import type"), {
                statusCode: 400,
                code: "INVALID_IMPORT_TYPE",
            });
        }
        const catalog = (0, importEntityFields_1.getImportEntityFieldCatalog)(importType);
        if (!catalog) {
            throw Object.assign(new Error("Unsupported import type"), {
                statusCode: 400,
                code: "INVALID_IMPORT_TYPE",
            });
        }
        const connector = await this.getConnectorOrThrow(accountId);
        const rules = (0, connectorFieldUtils_1.parseMappingRules)(mappingInput);
        const allowedFields = new Set(catalog.fields);
        for (const rule of rules) {
            if (!allowedFields.has(rule.archaserField)) {
                throw Object.assign(new Error(`Unknown Archaser field: ${rule.archaserField}`), { statusCode: 400, code: "INVALID_MAPPING_FIELD" });
            }
            if (!rule.erpField.trim()) {
                throw Object.assign(new Error("ERP field path is required"), {
                    statusCode: 400,
                    code: "INVALID_MAPPING_FIELD",
                });
            }
        }
        const isComplete = (0, connectorFieldUtils_1.computeMappingCompleteness)(importType, rules);
        const existing = await prisma_1.prisma.connectorFieldMapping.findUnique({
            where: {
                connector_id_import_type: {
                    connector_id: connector.id,
                    import_type: importType,
                },
            },
        });
        const saved = await prisma_1.prisma.connectorFieldMapping.upsert({
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
        const auditLog = SettingsAuditLogService_1.SettingsAuditLogService.getInstance();
        const auditPayload = (0, auditLogHelpers_1.sanitizeDataForLogging)({
            import_type: importType,
            mapping: rules,
            is_complete: isComplete,
        });
        if (existing) {
            await auditLog.logUpdate("billing-connector-mapping", saved.id, userId, accountId, (0, auditLogHelpers_1.sanitizeDataForLogging)({
                import_type: importType,
                mapping: (0, connectorFieldUtils_1.parseMappingRules)(existing.mapping),
                is_complete: existing.is_complete,
            }), auditPayload);
        }
        else {
            await auditLog.logCreate("billing-connector-mapping", saved.id, userId, accountId, auditPayload);
        }
        return this.toPublic(saved.import_type, saved.mapping, saved.is_complete, saved);
    }
    async assertMappingsCompleteForEnabledEntities(accountId) {
        const connector = await this.getConnectorOrThrow(accountId);
        const enabledEntities = Array.isArray(connector.enabled_entities)
            ? connector.enabled_entities
            : [];
        const mappings = await prisma_1.prisma.connectorFieldMapping.findMany({
            where: {
                connector_id: connector.id,
                import_type: { in: enabledEntities },
            },
        });
        const mappingByType = new Map(mappings.map((row) => [row.import_type, row]));
        const incomplete = enabledEntities.filter((entityType) => {
            const row = mappingByType.get(entityType);
            return !row?.is_complete;
        });
        if (incomplete.length > 0) {
            throw Object.assign(new Error(`Mapping incomplete for enabled entities: ${incomplete.join(", ")}`), { statusCode: 422, code: "MAPPING_INCOMPLETE" });
        }
    }
    toPublic(importType, mapping, isComplete, row) {
        return {
            import_type: importType,
            mapping: (0, connectorFieldUtils_1.parseMappingRules)(mapping),
            is_complete: isComplete,
            modified_at: row?.modified_at?.toISOString() ?? null,
            modified_by: row?.modified_by ?? null,
        };
    }
}
exports.ConnectorFieldMappingService = ConnectorFieldMappingService;
exports.connectorFieldMappingService = ConnectorFieldMappingService.getInstance();
