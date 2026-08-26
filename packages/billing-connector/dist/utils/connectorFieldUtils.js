"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getImportEntityFieldCatalog = getImportEntityFieldCatalog;
exports.isConnectorFieldTransform = isConnectorFieldTransform;
exports.parseMappingRules = parseMappingRules;
exports.isEmptyMappedValue = isEmptyMappedValue;
exports.extractNestedValue = extractNestedValue;
exports.applyConnectorTransform = applyConnectorTransform;
exports.mapErpRecord = mapErpRecord;
exports.flattenObjectPaths = flattenObjectPaths;
exports.discoverFieldPathsFromRecords = discoverFieldPathsFromRecords;
exports.buildDefaultMappingRules = buildDefaultMappingRules;
exports.autoMapConnectorRules = autoMapConnectorRules;
exports.validateMappedRow = validateMappedRow;
exports.computeMappingCompleteness = computeMappingCompleteness;
exports.rulesToRecordMapping = rulesToRecordMapping;
// Stubbed import entity field catalog - minimal impl for compile
function getImportEntityFieldCatalog(importType) {
    const catalogs = {
        Customer: {
            fields: [
                "name",
                "customer_number",
                "crn",
                "country_iso2",
                "state_iso2",
                "city",
                "address_line1",
                "address_line2",
                "postal_code",
                "owner_email",
                "business_unit",
                "parent_customer_number",
            ],
            requiredFields: ["customer_number"],
            highlightedFields: ["customer_number"],
        },
        Contact: {
            fields: [
                "erp_contact_id",
                "customer_number",
                "first_name",
                "last_name",
                "email",
                "phone",
                "mobile",
                "role",
                "company_wide_address",
                "receives_standard_reminder",
                "receives_escalated_reminder",
            ],
            requiredFields: ["erp_contact_id", "customer_number"],
            highlightedFields: ["erp_contact_id", "customer_number"],
        },
        Invoice: {
            fields: [
                "customer_number",
                "invoice_number",
                "invoice_date",
                "due_date",
                "base_amount",
                "invoice_amount",
                "customer_total_paid",
                "currency",
                "credit_for_invoice_number",
                "custom_code1",
            ],
            requiredFields: [
                "customer_number",
                "invoice_number",
                "invoice_date",
                "base_amount",
                "invoice_amount",
            ],
            highlightedFields: ["invoice_number", "customer_number", "invoice_date"],
        },
        Payment: {
            fields: [
                "reference",
                "customer_number",
                "invoice_number",
                "payment_date",
                "amount",
                "customer_amount",
                "customer_currency",
                "payment_method",
            ],
            requiredFields: [
                "reference",
                "customer_number",
                "invoice_number",
                "payment_date",
                "customer_amount",
                "customer_currency",
            ],
            highlightedFields: ["reference", "customer_number", "invoice_number"],
        },
    };
    return catalogs[importType] ?? null;
}
// Stubbed priority imports - will be fixed via relative imports
function getPriorityEntityEndpoint(importType) {
    const endpoints = {
        Customer: { archaserIdField: "customer_number", erpPrimaryKeyFields: ["CUSTNAME"] },
        Contact: { archaserIdField: "erp_contact_id", erpPrimaryKeyFields: ["KLINE"] },
        Invoice: { archaserIdField: "invoice_number", erpPrimaryKeyFields: ["IVNUM", "IVTYPE"] },
        Payment: { archaserIdField: "reference", erpPrimaryKeyFields: ["PAYNUM"] },
    };
    return endpoints[importType] ?? null;
}
function isPriorityEntityImportType(importType) {
    return ["Customer", "Contact", "Invoice", "Payment"].includes(importType);
}
const PRIORITY_DEFAULT_ERP_FIELDS = {
    Customer: {
        customer_number: "CUSTNAME",
        name: "CUSTDES",
        crn: "WTAXNUM",
        owner_email: "EMAIL",
        address_line1: "ADDRESS",
        address_line2: "ADDRESS2",
        city: "STATEA",
        state_iso2: "STATECODE",
        postal_code: "ZIP",
        country_iso2: "COUNTRYCODE",
        business_unit: "IDG_COMPANYNAME",
        parent_customer_number: "MCUSTNAME",
    },
    Contact: {
        erp_contact_id: "KLINE",
        customer_number: "CUSTNAME",
        first_name: "FIRSTNAME",
        last_name: "LASTNAME",
        email: "EMAIL",
        phone: "PHONE",
        mobile: "CELLPHONE",
        role: "POSITIONDES",
    },
    Invoice: {
        customer_number: "CUSTNAME",
        invoice_number: "IVNUM",
        invoice_date: "IVDATE",
        due_date: "DUEDATE",
        base_amount: "TOTPRICE",
        invoice_amount: "TOTPRICE",
        currency: "CODE",
        credit_for_invoice_number: "CREDITFOR",
        custom_code1: "DEBIT",
    },
    Payment: {
        reference: "IVNUM",
        customer_number: "CUSTNAME",
        invoice_number: "FNCIREF1",
        payment_date: "PAYDATE",
        amount: "PAYMENT",
        customer_amount: "PAYMENT",
        customer_currency: "CODE",
        payment_method: "PAYDES",
    },
};
const DEFAULT_TRANSFORMS = {
    Customer: {
        customer_number: "trim",
        name: "trim",
    },
    Contact: {
        erp_contact_id: "trim",
        customer_number: "trim",
        first_name: "trim",
        last_name: "trim",
        email: "trim",
    },
    Invoice: {
        invoice_date: "date",
        due_date: "date",
        currency: "currency_code",
    },
    Payment: {
        payment_date: "date",
        customer_currency: "currency_code",
        reference: "trim",
    },
};
function isConnectorFieldTransform(value) {
    return (value === "date" ||
        value === "boolean" ||
        value === "trim" ||
        value === "currency_code");
}
function parseMappingRules(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const rules = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const rule = item;
        const archaserField = typeof rule.archaserField === "string"
            ? rule.archaserField.trim()
            : "";
        const erpField = typeof rule.erpField === "string" ? rule.erpField.trim() : "";
        const defaultValue = typeof rule.defaultValue === "string"
            ? rule.defaultValue
            : undefined;
        const hasDefault = defaultValue !== undefined && defaultValue.trim() !== "";
        if (!archaserField || (!erpField && !hasDefault)) {
            continue;
        }
        const parsed = { archaserField, erpField };
        if (isConnectorFieldTransform(rule.transform)) {
            parsed.transform = rule.transform;
        }
        if (hasDefault) {
            parsed.defaultValue = defaultValue;
        }
        rules.push(parsed);
    }
    return rules;
}
function isEmptyMappedValue(value) {
    return (value === null ||
        value === undefined ||
        (typeof value === "string" && value.trim() === ""));
}
function extractNestedValue(obj, path) {
    const parts = path.split(".").filter(Boolean);
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) {
            return undefined;
        }
        if (Array.isArray(current)) {
            current = current[0];
        }
        if (current === null ||
            current === undefined ||
            typeof current !== "object") {
            return undefined;
        }
        const record = current;
        let val = record[part];
        if (val !== undefined && val !== null && val !== "") {
            current = val;
            continue;
        }
        const lowerPart = part.toLowerCase();
        const foundKey = Object.keys(record).find((k) => k.toLowerCase() === lowerPart);
        if (foundKey &&
            record[foundKey] !== undefined &&
            record[foundKey] !== null &&
            record[foundKey] !== "") {
            current = record[foundKey];
            continue;
        }
        if (part === "FNCIREF1" || part === "PAY_INVOICE_NUMBER") {
            val =
                record.FNCIREF1 ??
                    record.PAY_INVOICE_NUMBER ??
                    record.IVNUM ??
                    record.PAY_REFERENCE;
        }
        else if (part === "PAYNUM" || part === "PAY_REFERENCE") {
            val =
                record.PAY_REFERENCE ??
                    record.PAYNUM ??
                    record.FNCNUM ??
                    record.FNCIREF1 ??
                    record.IVNUM;
        }
        else if (part === "PAYDATE" || part === "PAY_DATE") {
            val =
                record.PAY_DATE ??
                    record.PAYDATE ??
                    record.FNCDATE ??
                    record.BALDATE;
        }
        else if (part === "PAYMENT" || part === "PAY_AMOUNT") {
            val =
                record.PAY_AMOUNT ??
                    record.PAYMENT ??
                    record.CREDIT1 ??
                    record.DEBIT1 ??
                    record.CREDIT ??
                    record.DEBIT;
        }
        current = val;
    }
    if (Array.isArray(current)) {
        current = current[0];
    }
    return current;
}
function applyConnectorTransform(value, transform) {
    if (value === null || value === undefined) {
        return value;
    }
    switch (transform) {
        case "trim":
            return String(value).trim();
        case "currency_code":
            return String(value).trim().toUpperCase();
        case "boolean": {
            if (typeof value === "boolean") {
                return value;
            }
            const normalized = String(value).trim().toLowerCase();
            if (["true", "1", "yes", "y"].includes(normalized)) {
                return true;
            }
            if (["false", "0", "no", "n"].includes(normalized)) {
                return false;
            }
            return value;
        }
        case "date": {
            if (value instanceof Date) {
                return value.toISOString().slice(0, 10);
            }
            const parsed = new Date(String(value));
            if (Number.isNaN(parsed.getTime())) {
                return String(value).trim();
            }
            return parsed.toISOString().slice(0, 10);
        }
        default:
            return value;
    }
}
function mapErpRecord(erpRecord, rules) {
    const result = {};
    Object.defineProperty(result, "_rawRecord", {
        value: erpRecord,
        enumerable: true,
        writable: true,
        configurable: true,
    });
    for (const rule of rules) {
        let value;
        if (rule.erpField.trim()) {
            const raw = extractNestedValue(erpRecord, rule.erpField);
            value = applyConnectorTransform(raw, rule.transform);
        }
        else {
            value = undefined;
        }
        if (rule.archaserField === "invoice_number") {
            const rawFnci = extractNestedValue(erpRecord, "FNCIREF1") ??
                extractNestedValue(erpRecord, "PAY_INVOICE_NUMBER");
            if (typeof rawFnci === "string" && rawFnci.trim()) {
                value = rawFnci.trim();
            }
        }
        if (rule.archaserField === "reference") {
            const syntheticRef = extractNestedValue(erpRecord, "PAY_REFERENCE") ??
                erpRecord.PAY_REFERENCE;
            if (syntheticRef !== null &&
                syntheticRef !== undefined &&
                String(syntheticRef).trim() !== "") {
                value = String(syntheticRef).trim();
            }
        }
        if (rule.archaserField === "reference" &&
            isEmptyMappedValue(value)) {
            const rawRef = extractNestedValue(erpRecord, "IVNUM") ??
                extractNestedValue(erpRecord, "PAY_REFERENCE") ??
                extractNestedValue(erpRecord, "PAYNUM") ??
                extractNestedValue(erpRecord, "FNCNUM") ??
                extractNestedValue(erpRecord, "TRANSNUM") ??
                extractNestedValue(erpRecord, "DOCNUM") ??
                extractNestedValue(erpRecord, "FNCIREF1");
            if (rawRef !== null &&
                rawRef !== undefined &&
                String(rawRef).trim() !== "") {
                const kline = extractNestedValue(erpRecord, "KLINE");
                const fnci = extractNestedValue(erpRecord, "FNCIREF1");
                const strRef = String(rawRef).trim();
                if (kline !== null &&
                    kline !== undefined &&
                    String(kline).trim() !== "" &&
                    !strRef.includes("|")) {
                    value = `${strRef}|${String(kline).trim()}`;
                }
                else if (fnci !== null &&
                    fnci !== undefined &&
                    String(fnci).trim() !== "" &&
                    !strRef.includes("|") &&
                    strRef !== String(fnci).trim()) {
                    value = `${strRef}|${String(fnci).trim()}`;
                }
                else {
                    value = strRef;
                }
            }
        }
        if (rule.archaserField === "credit_for_invoice_number" &&
            isEmptyMappedValue(value)) {
            const rawCreditFor = extractNestedValue(erpRecord, "CREDITFOR") ??
                extractNestedValue(erpRecord, "PIVNUM") ??
                extractNestedValue(erpRecord, "CINVOICESCONT_SUBFORM.PIVNUM");
            if (typeof rawCreditFor === "string" && rawCreditFor.trim()) {
                value = rawCreditFor.trim();
            }
        }
        if (isEmptyMappedValue(value) &&
            rule.defaultValue !== undefined &&
            rule.defaultValue.trim() !== "") {
            value = applyConnectorTransform(rule.defaultValue, rule.transform);
        }
        result[rule.archaserField] = value;
    }
    return result;
}
function flattenObjectPaths(obj, prefix = "", maxDepth = 4) {
    const paths = [];
    const exampleValues = {};
    const walk = (value, currentPrefix, depth) => {
        if (depth > maxDepth) {
            return;
        }
        if (value === null || value === undefined) {
            if (currentPrefix) {
                paths.push(currentPrefix);
                exampleValues[currentPrefix] = value;
            }
            return;
        }
        if (Array.isArray(value)) {
            if (currentPrefix) {
                paths.push(currentPrefix);
                exampleValues[currentPrefix] = value[0] ?? null;
            }
            if (value.length > 0 && typeof value[0] === "object" && value[0]) {
                walk(value[0], currentPrefix, depth + 1);
            }
            return;
        }
        if (typeof value !== "object") {
            if (currentPrefix) {
                paths.push(currentPrefix);
                exampleValues[currentPrefix] = value;
            }
            return;
        }
        const entries = Object.entries(value);
        if (entries.length === 0 && currentPrefix) {
            paths.push(currentPrefix);
            exampleValues[currentPrefix] = value;
            return;
        }
        for (const [key, child] of entries) {
            const nextPrefix = currentPrefix ? `${currentPrefix}.${key}` : key;
            if (child !== null && typeof child === "object" && !Array.isArray(child)) {
                walk(child, nextPrefix, depth + 1);
            }
            else {
                paths.push(nextPrefix);
                exampleValues[nextPrefix] = child;
            }
        }
    };
    walk(obj, prefix, 0);
    return {
        paths: Array.from(new Set(paths)).sort(),
        exampleValues,
    };
}
function discoverFieldPathsFromRecords(records) {
    const mergedPaths = new Set();
    const exampleValues = {};
    for (const record of records) {
        const flattened = flattenObjectPaths(record);
        for (const path of flattened.paths) {
            mergedPaths.add(path);
            if (exampleValues[path] === undefined &&
                flattened.exampleValues[path] !== undefined) {
                exampleValues[path] = flattened.exampleValues[path];
            }
        }
    }
    return {
        rawHeaders: Array.from(mergedPaths).sort(),
        exampleValues,
    };
}
function buildDefaultMappingRules(importType) {
    if (!isPriorityEntityImportType(importType)) {
        return [];
    }
    const catalog = getImportEntityFieldCatalog(importType);
    if (!catalog) {
        return [];
    }
    const defaults = PRIORITY_DEFAULT_ERP_FIELDS[importType] ?? {};
    const transforms = DEFAULT_TRANSFORMS[importType] ?? {};
    const endpoint = getPriorityEntityEndpoint(importType);
    if (!endpoint) {
        return [];
    }
    const rules = [];
    for (const archaserField of catalog.fields) {
        const erpField = defaults[archaserField] ??
            (archaserField === endpoint.archaserIdField
                ? endpoint.erpPrimaryKeyFields[0]
                : undefined);
        if (!erpField) {
            continue;
        }
        const rule = { archaserField, erpField };
        const transform = transforms[archaserField];
        if (transform) {
            rule.transform = transform;
        }
        rules.push(rule);
    }
    return rules;
}
function autoMapConnectorRules(importType, rawHeaders, existingRules = []) {
    const catalog = getImportEntityFieldCatalog(importType);
    if (!catalog) {
        return existingRules;
    }
    const existingByField = new Map(existingRules.map((rule) => [rule.archaserField, rule]));
    const defaults = buildDefaultMappingRules(importType);
    const defaultByField = new Map(defaults.map((rule) => [rule.archaserField, rule]));
    const headerSet = new Set(rawHeaders.map((header) => header.toLowerCase()));
    const rules = [];
    for (const archaserField of catalog.fields) {
        const existing = existingByField.get(archaserField);
        if (existing?.erpField) {
            rules.push(existing);
            continue;
        }
        const defaultRule = defaultByField.get(archaserField);
        if (defaultRule && headerSet.has(defaultRule.erpField.toLowerCase())) {
            rules.push(defaultRule);
            continue;
        }
        const fuzzy = rawHeaders.find((header) => {
            const headerLower = header.toLowerCase();
            const fieldLower = archaserField.toLowerCase();
            return (headerLower === fieldLower ||
                headerLower.endsWith(`.${fieldLower}`) ||
                headerLower.includes(fieldLower));
        });
        if (fuzzy) {
            rules.push({ archaserField, erpField: fuzzy });
        }
    }
    return rules;
}
function validateMappedRow(importType, row, rowIndex) {
    const catalog = getImportEntityFieldCatalog(importType);
    if (!catalog) {
        return [];
    }
    const errors = [];
    for (const field of catalog.requiredFields) {
        const value = row[field];
        if (value === null ||
            value === undefined ||
            (typeof value === "string" && value.trim() === "")) {
            errors.push(`Row ${rowIndex + 1}: required field "${field}" is missing or empty`);
        }
    }
    return errors;
}
function computeMappingCompleteness(importType, rules) {
    const catalog = getImportEntityFieldCatalog(importType);
    if (!catalog) {
        return false;
    }
    const mappedFields = new Set(rules
        .filter((rule) => rule.erpField.trim() ||
        (rule.defaultValue !== undefined &&
            rule.defaultValue.trim() !== ""))
        .map((rule) => rule.archaserField));
    return catalog.requiredFields.every((field) => mappedFields.has(field));
}
function rulesToRecordMapping(rules) {
    const result = {};
    for (const rule of rules) {
        result[rule.archaserField] = {
            erpField: rule.erpField,
            transform: rule.transform,
        };
    }
    return result;
}
