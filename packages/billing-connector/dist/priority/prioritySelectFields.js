"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.odataSelectFieldsFromMapping = odataSelectFieldsFromMapping;
const SYNTHETIC_SOURCE_FIELDS = {
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
 * Always request on Payment pulls when the table exposes them.
 * FRECONNUM / BAL drive recon virtual-close; PAY_REFERENCE sources are needed
 * even when the connector maps `reference` to IVNUM/PAYNUM instead of PAY_REFERENCE.
 * CREDIT5/DEBIT5/CODE5/CURDATE are Priority dual-currency / rate-date fields on
 * IDG_ARFNCITEMS4 (discovered for account 10149) — needed for FX diagnosis/conversion.
 */
const PAYMENT_ALWAYS_SELECT_SOURCES = [
    "BAL",
    "CODE",
    "CODE5",
    "COMPANYNAME",
    "CREDIT1",
    "CREDIT5",
    "DEBIT1",
    "DEBIT5",
    "CURDATE",
    "IDG_CUSTNAME",
    ...SYNTHETIC_SOURCE_FIELDS.PAY_REFERENCE,
];
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
function isODataIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
function topLevelODataField(erpField) {
    const trimmed = erpField.trim();
    if (!trimmed || trimmed.includes(".") || /_SUBFORM/i.test(trimmed)) {
        return null;
    }
    if (!isODataIdentifier(trimmed)) {
        return null;
    }
    return trimmed;
}
function addField(fields, value, omit) {
    const name = topLevelODataField(value);
    if (!name || omit.has(name)) {
        return;
    }
    fields.add(name);
}
function omitFieldsForEntity(entityType) {
    if (entityType === "Invoice") {
        return OMIT_FROM_INVOICE_SELECT;
    }
    if (entityType === "Customer" ||
        entityType === "Contact" ||
        entityType === "Payment") {
        return OMIT_UDATE_FROM_SELECT;
    }
    return new Set();
}
/**
 * OData $select columns from connector mappings.
 * Nested / subform paths are skipped (list pulls do not $expand).
 * Synthetic PAY_* fields expand to the source columns used at map time.
 */
function odataSelectFieldsFromMapping(options) {
    const omit = omitFieldsForEntity(options.entityType);
    const fields = new Set();
    for (const extra of options.extraFields ?? []) {
        addField(fields, extra, omit);
    }
    if (options.entityType === "Payment") {
        for (const source of PAYMENT_ALWAYS_SELECT_SOURCES) {
            addField(fields, source, omit);
        }
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
        }
        else {
            addField(fields, name, omit);
        }
    }
    return Array.from(fields).sort((a, b) => a.localeCompare(b));
}
