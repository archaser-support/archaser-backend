import type { ImportType } from "@prisma/client";
import type { MappingRule } from "../utils/connectorFieldUtils";
/**
 * OData $select columns from connector mappings.
 * Nested / subform paths are skipped (list pulls do not $expand).
 * Synthetic PAY_* fields expand to the source columns used at map time.
 */
export declare function odataSelectFieldsFromMapping(options: {
    mappingRules: MappingRule[];
    extraFields?: readonly string[];
    entityType?: ImportType | string;
}): string[];
