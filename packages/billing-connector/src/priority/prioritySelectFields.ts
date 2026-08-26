import type { ImportType } from "@prisma/client";

import type { MappingRule } from "../utils/connectorFieldUtils";

const SYNTHETIC_SOURCE_FIELDS: Record<string, readonly string[]> = {
    PAY_AMOUNT: ["PAYMENT", "CREDIT1", "DEBIT1", "CREDIT", "DEBIT"],
    PAY_DATE: ["PAYDATE", "FNCDATE", "BALDATE"],
    PAY_REFERENCE: [
        "FRECONNUM",
        "FNCNUM",
        "KLINE",
        "IVNUM",
        "PAYNUM",
        "TRANSNUM",
        "DOCNUM",
        "FNCIREF1",
    ],
    PAY_INVOICE_NUMBER: ["FNCIREF1", "IVNUM"],
    PAYDES: ["PAYDES", "FNCPATNAME"],
};

/**
 * Not on CINVOICES for this Priority OData form. PIVNUM/CREDITFOR are subform
 * (or absent). PAYDATE is a payment column that invoice mappings sometimes include.
 */
const OMIT_FROM_INVOICE_SELECT = new Set(["PIVNUM", "CREDITFOR", "PAYDATE"]);

/**
 * Not on CUSTOMERS, and not on account 10149's payment table
 * (IDG_ARFNCITEMS4). CUSTPERSONNEL was never discovered with UDATE.
 * Requesting it in $select returns HTTP 400. CINVOICES does expose UDATE.
 */
const OMIT_UDATE_FROM_SELECT = new Set(["UDATE"]);

function isODataIdentifier(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function topLevelODataField(erpField: string): string | null {
    const trimmed = erpField.trim();
    if (!trimmed || trimmed.includes(".") || /_SUBFORM/i.test(trimmed)) {
        return null;
    }
    if (!isODataIdentifier(trimmed)) {
        return null;
    }
    return trimmed;
}

function addField(
    fields: Set<string>,
    value: string,
    omit: ReadonlySet<string>
): void {
    const name = topLevelODataField(value);
    if (!name || omit.has(name)) {
        return;
    }
    fields.add(name);
}

function omitFieldsForEntity(
    entityType?: ImportType | string
): ReadonlySet<string> {
    if (entityType === "Invoice") {
        return OMIT_FROM_INVOICE_SELECT;
    }
    if (
        entityType === "Customer" ||
        entityType === "Contact" ||
        entityType === "Payment"
    ) {
        return OMIT_UDATE_FROM_SELECT;
    }
    return new Set();
}

/**
 * OData $select columns from connector mappings.
 * Nested / subform paths are skipped (list pulls do not $expand).
 * Synthetic PAY_* fields expand to the source columns used at map time.
 */
export function odataSelectFieldsFromMapping(options: {
    mappingRules: MappingRule[];
    extraFields?: readonly string[];
    entityType?: ImportType | string;
}): string[] {
    const omit = omitFieldsForEntity(options.entityType);
    const fields = new Set<string>();
    for (const extra of options.extraFields ?? []) {
        addField(fields, extra, omit);
    }
    for (const rule of options.mappingRules) {
        const name = topLevelODataField(rule.erpField);
        if (!name) {
            continue;
        }
        const sources = SYNTHETIC_SOURCE_FIELDS[name];
        if (sources) {
            for (const source of sources) {
                addField(fields, source, omit);
            }
        } else {
            addField(fields, name, omit);
        }
    }
    return Array.from(fields).sort((a, b) => a.localeCompare(b));
}
