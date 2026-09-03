"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDaysOverdue = calculateDaysOverdue;
exports.calculateDaysUntilDue = calculateDaysUntilDue;
exports.calculateDaysLeft = calculateDaysLeft;
exports.extractTermsBreachReasonCodes = extractTermsBreachReasonCodes;
exports.computedFieldToPrismaWhere = computedFieldToPrismaWhere;
exports.getComputedFieldFilterCodes = getComputedFieldFilterCodes;
exports.formatTermsBreachReasonForDisplay = formatTermsBreachReasonForDisplay;
exports.isPrismaScalarField = isPrismaScalarField;
exports.isPrismaListRelation = isPrismaListRelation;
exports.applyComputedFieldSelect = applyComputedFieldSelect;
exports.extractComputedFieldValue = extractComputedFieldValue;
exports.isComputedReportField = isComputedReportField;
exports.resolveComputedSortTarget = resolveComputedSortTarget;
exports.sortFormattedReportRows = sortFormattedReportRows;
const client_1 = require("@prisma/client");
const credit_insurance_domain_1 = require("@archaser/credit-insurance-domain");
const credit_insurance_domain_2 = require("@archaser/credit-insurance-domain");
const report_constants_1 = require("./report.constants");
/** Report table name → Prisma DMMF model name. */
const REPORT_TABLE_TO_PRISMA_MODEL = {
    Customer: "Customer",
    Invoice: "Invoice",
    InvoicePayment: "InvoicePayment",
    Contact: "Contact",
    Activity: "Activity",
    Dispute: "CustomerDispute",
    CustomerCollectionPeriod: "CustomerCollectionPeriod",
    CustomerBanks: "CustomerBanks",
    AccountBankAccounts: "AccountBankAccounts",
    Person: "Person",
    Company: "Company",
    User: "User",
    BusinessUnit: "BusinessUnit",
    Country: "Country",
    State: "State",
    InsurancePolicy: "InsurancePolicy",
};
const scalarFieldCache = new Map();
const listRelationCache = new Map();
/** Calendar-day age past due_date (0 when not yet overdue). */
function calculateDaysOverdue(dueDate, now = new Date()) {
    if (dueDate == null)
        return null;
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime()))
        return null;
    return Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
}
/** Calendar days until due_date (can be negative if overdue). */
function calculateDaysUntilDue(dueDate, now = new Date()) {
    if (dueDate == null)
        return null;
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime()))
        return null;
    return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
/** Non-negative calendar days remaining until date (0 when past). */
function calculateDaysLeft(endDate, now = new Date()) {
    if (endDate == null)
        return null;
    const end = new Date(endDate);
    if (Number.isNaN(end.getTime()))
        return null;
    return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}
function extractTermsBreachReasonCodes(row) {
    const codes = [];
    if (row.reporting_breach)
        codes.push("reporting_breach");
    if (row.ctv_payment_term)
        codes.push("ctv_payment_term");
    if (row.ctv_customer_overdue_mep)
        codes.push("ctv_customer_overdue_mep");
    if (row.ctv_outdated_dcl)
        codes.push("ctv_outdated_dcl");
    if (row.ctv_invoice_after_policy_end) {
        codes.push("ctv_invoice_after_policy_end");
    }
    return codes.join(" · ");
}
/**
 * Computed report fields have no column of their own, so filters on them must
 * be rewritten against the columns they derive from. The mapping lives here as
 * data so `computedFieldToPrismaWhere` stays generic: supporting another field
 * is a new entry, not another branch.
 */
const COMPUTED_FILTER_MAPPINGS = [
    {
        table: "Invoice",
        field: "terms_breach_reason",
        kind: "boolean_set",
        // Deliberately excludes ctv_customer_excluded_from_policy, matching
        // extractTermsBreachReasonCodes.
        columnByCode: {
            reporting_breach: "reporting_breach",
            ctv_payment_term: "ctv_payment_term",
            ctv_customer_overdue_mep: "ctv_customer_overdue_mep",
            ctv_outdated_dcl: "ctv_outdated_dcl",
            ctv_invoice_after_policy_end: "ctv_invoice_after_policy_end",
        },
    },
];
const PRESENCE_OPERATORS = new Set([
    "is_not_empty",
    "is_not_null",
    "isnotnull",
]);
const ABSENCE_OPERATORS = new Set(["is_empty", "is_null", "isnull"]);
const ANY_OF_OPERATORS = new Set(["in", "equals", "="]);
const NONE_OF_OPERATORS = new Set(["not_in", "not_equals", "not", "!="]);
function matchesAnyColumn(columns) {
    return { OR: columns.map((column) => ({ [column]: true })) };
}
function matchesNoColumn(columns) {
    // `not: true` also matches NULL, which reads as "flag not set".
    return { AND: columns.map((column) => ({ [column]: { not: true } })) };
}
function parseFilterCodes(value) {
    const raw = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(",")
            : value == null
                ? []
                : [value];
    return raw.map((item) => String(item).trim()).filter(Boolean);
}
/**
 * Prisma where clause for a filter on a computed report field. Returns null
 * when the field or operator is unsupported, and the caller then drops the
 * filter as before.
 */
function computedFieldToPrismaWhere(table, field, operator, value) {
    const mapping = COMPUTED_FILTER_MAPPINGS.find((candidate) => candidate.table === table && candidate.field === field);
    if (!mapping) {
        return null;
    }
    const op = (operator || "").toLowerCase();
    if (PRESENCE_OPERATORS.has(op)) {
        return matchesAnyColumn(Object.values(mapping.columnByCode));
    }
    if (ABSENCE_OPERATORS.has(op)) {
        return matchesNoColumn(Object.values(mapping.columnByCode));
    }
    const isAnyOf = ANY_OF_OPERATORS.has(op);
    if (!isAnyOf && !NONE_OF_OPERATORS.has(op)) {
        return null;
    }
    const columns = Array.from(new Set(parseFilterCodes(value)
        .map((code) => mapping.columnByCode[code])
        .filter((column) => !!column)));
    // An empty or unrecognised selection carries no intent; drop it rather
    // than match nothing.
    if (columns.length === 0) {
        return null;
    }
    return isAnyOf ? matchesAnyColumn(columns) : matchesNoColumn(columns);
}
/** Filter value codes offered for a computed field, for report metadata. */
function getComputedFieldFilterCodes(table, field) {
    const mapping = COMPUTED_FILTER_MAPPINGS.find((candidate) => candidate.table === table && candidate.field === field);
    return mapping ? Object.keys(mapping.columnByCode) : [];
}
const TERMS_BREACH_CODE_TO_CAUSE = {
    reporting_breach: "reporting_breach",
    ctv_payment_term: "payment_term",
    ctv_customer_overdue_mep: "customer_overdue_mep",
    ctv_outdated_dcl: "outdated_dcl",
    ctv_invoice_after_policy_end: "invoice_after_policy_end",
};
// Wording mirrors locales/{en,he}/invoices.json so the report cell and the
// filter pick-list name each reason identically.
const TERMS_BREACH_CAUSE_LABELS = {
    en: {
        reporting_breach: "Reporting Breach",
        payment_term: "Terms violation at creation (payment term)",
        customer_overdue_mep: "Terms violation at creation (customer overdue MEP)",
        outdated_dcl: "Terms violation at creation (outdated DCL)",
        invoice_after_policy_end: "Terms violation at creation (invoice after policy end)",
    },
    he: {
        reporting_breach: "חריגת דיווח",
        payment_term: "הפרת תנאים בעת יצירה (תנאי תשלום)",
        customer_overdue_mep: "הפרת תנאים בעת יצירה (לקוח בפיגור MEP)",
        outdated_dcl: "הפרת תנאים בעת יצירה (DCL לא עדכני)",
        invoice_after_policy_end: "הפרת תנאים בעת יצירה (חשבונית לאחר סיום הפוליסה)",
    },
};
function formatTermsBreachReasonForDisplay(codesJoined, locale) {
    if (codesJoined == null || String(codesJoined).trim() === "") {
        return "";
    }
    const language = (locale?.split("-")[0] === "he" ? "he" : "en");
    const labels = TERMS_BREACH_CAUSE_LABELS[language];
    return String(codesJoined)
        .split(" · ")
        .map((code) => {
        const trimmed = code.trim();
        if (!trimmed)
            return "";
        const causeKey = TERMS_BREACH_CODE_TO_CAUSE[trimmed] ?? trimmed;
        return labels[causeKey] ?? trimmed;
    })
        .filter(Boolean)
        .join(" · ");
}
/** True when `field` is a scalar column on the Prisma model for `reportTable`. */
function isPrismaScalarField(reportTable, field) {
    if (!field || field.includes(".") || field.startsWith("__")) {
        return false;
    }
    const modelName = REPORT_TABLE_TO_PRISMA_MODEL[reportTable];
    if (!modelName) {
        return false;
    }
    let scalars = scalarFieldCache.get(modelName);
    if (!scalars) {
        const model = client_1.Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
        scalars = new Set((model?.fields || [])
            .filter((f) => f.kind === "scalar" || f.kind === "enum")
            .map((f) => f.name));
        scalarFieldCache.set(modelName, scalars);
    }
    return scalars.has(field);
}
/**
 * True when `relationField` is a to-many relation on the Prisma model for
 * `reportTable`. Prisma requires `some`/`every`/`none` on list relations, so
 * callers must wrap field filters instead of nesting them directly.
 */
function isPrismaListRelation(reportTable, relationField) {
    const modelName = REPORT_TABLE_TO_PRISMA_MODEL[reportTable];
    if (!modelName) {
        return false;
    }
    let lists = listRelationCache.get(modelName);
    if (!lists) {
        const model = client_1.Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
        lists = new Set((model?.fields || [])
            .filter((f) => f.kind === "object" && f.isList)
            .map((f) => f.name));
        listRelationCache.set(modelName, lists);
    }
    return lists.has(relationField);
}
/**
 * Expand known computed report fields into real Prisma select keys.
 * Returns true when handled (caller must not select `field` as a scalar).
 */
function applyComputedFieldSelect(primaryTable, field, select) {
    if (primaryTable === "Invoice") {
        if (field === "days_overdue" || field === "days_until_due") {
            select.due_date = true;
            return true;
        }
        if (field === "days_left_for_reporting") {
            select.target_reporting_date = true;
            return true;
        }
        if (field === "terms_breach_reason") {
            select.reporting_breach = true;
            select.ctv_payment_term = true;
            select.ctv_customer_overdue_mep = true;
            select.ctv_outdated_dcl = true;
            select.ctv_invoice_after_policy_end = true;
            return true;
        }
        return false;
    }
    if (primaryTable === "Customer") {
        if (field === "days_overdue") {
            select.oldest_invoice_overdue_date = true;
            return true;
        }
        if (field === "limit_expires_in_days") {
            (0, credit_insurance_domain_2.mergeActiveCustomerPolicySelect)(select, [
                "approved_limit_expiration_date",
            ]);
            return true;
        }
        if (field === "company_number") {
            select.Company = {
                select: {
                    ...(select.Company
                        ?.select || {}),
                    id: true,
                    company_number: true,
                    name: true,
                },
            };
            return true;
        }
        // Enriched-only fields: keep them out of the Prisma select.
        if (field === "open_receivable_amount" ||
            field === "open_invoice_count" ||
            field === "terms_breach_outstanding" ||
            field === "policy_risk_allocated" ||
            field === "at_risk_exposure" ||
            field === "limit_warning_summary" ||
            field === "top_up_type" ||
            field === "top_up_value" ||
            field === "top_up_resolved_amount" ||
            field === "top_up_end_date" ||
            field === "top_up_days_left" ||
            field === "as_of_utilization_pct" ||
            field === "as_of_usage_amount") {
            return true;
        }
        return false;
    }
    return false;
}
/**
 * Extract a computed report field value from a loaded Prisma row.
 * Returns `undefined` when the field is not a known computed field.
 */
function extractComputedFieldValue(primaryTable, field, row) {
    if (primaryTable === "Invoice") {
        if (field === "days_overdue") {
            return calculateDaysOverdue(row.due_date);
        }
        if (field === "days_until_due") {
            return calculateDaysUntilDue(row.due_date);
        }
        if (field === "days_left_for_reporting") {
            return calculateDaysLeft(row.target_reporting_date);
        }
        if (field === "terms_breach_reason") {
            return extractTermsBreachReasonCodes(row);
        }
        return undefined;
    }
    if (primaryTable === "Customer") {
        if (field === "days_overdue") {
            return calculateDaysOverdue(row.oldest_invoice_overdue_date);
        }
        if (field === "limit_expires_in_days") {
            const policy = (0, credit_insurance_domain_1.getCustomerPolicyRow)(row);
            return calculateDaysLeft(policy?.approved_limit_expiration_date ?? null);
        }
        if (field === "company_number") {
            const company = row.Company;
            return company?.company_number ?? null;
        }
        // Post-query enrichment (Open AR, policy risk, as-of utilization, …)
        // writes these onto the row; treat as computed so we never hit Prisma.
        if (field === "open_receivable_amount" ||
            field === "open_invoice_count" ||
            field === "terms_breach_outstanding" ||
            field === "policy_risk_allocated" ||
            field === "at_risk_exposure" ||
            field === "limit_warning_summary" ||
            field === "top_up_type" ||
            field === "top_up_value" ||
            field === "top_up_resolved_amount" ||
            field === "top_up_end_date" ||
            field === "top_up_days_left" ||
            field === "as_of_utilization_pct" ||
            field === "as_of_usage_amount") {
            return row[field] ?? null;
        }
        return undefined;
    }
    return undefined;
}
/** True when sorting/filtering by this primary field must not hit Prisma. */
function isComputedReportField(primaryTable, field) {
    if (primaryTable === "Invoice") {
        return (field === "days_overdue" ||
            field === "days_until_due" ||
            field === "days_left_for_reporting" ||
            field === "terms_breach_reason");
    }
    if (primaryTable === "Customer") {
        return (field === "days_overdue" ||
            field === "company_number" ||
            field === "limit_expires_in_days" ||
            field === "top_up_total" ||
            field === "effective_approved_limit" ||
            field === "open_receivable_amount" ||
            field === "open_invoice_count" ||
            field === "terms_breach_outstanding" ||
            field === "policy_risk_allocated" ||
            field === "at_risk_exposure" ||
            field === "limit_warning_summary" ||
            field === "top_up_type" ||
            field === "top_up_value" ||
            field === "top_up_resolved_amount" ||
            field === "top_up_end_date" ||
            field === "top_up_days_left" ||
            field === "as_of_utilization_pct" ||
            field === "as_of_usage_amount");
    }
    if (primaryTable === "Activity") {
        return field === "call_time" || field === "call_direction";
    }
    if (primaryTable === "Dispute") {
        return (field === "dispute_number" ||
            field === "assigned_to" ||
            field === "dispute_reason" ||
            field === "amount_in_dispute" ||
            field === "days_past_due");
    }
    return false;
}
/** Match a client sort field to a computed column that must sort after formatRow. */
function resolveComputedSortTarget(sortField, primaryTable, fields) {
    const raw = (sortField || "").trim();
    if (!raw) {
        return null;
    }
    for (const f of fields) {
        const outputKey = (0, report_constants_1.getFieldOutputKey)(f);
        const matches = outputKey === raw ||
            f.field === raw ||
            `${f.table}.${f.field}` === raw ||
            (raw.startsWith(`${primaryTable}.`) &&
                raw.slice(primaryTable.length + 1) === f.field);
        if (matches && isComputedReportField(f.table, f.field)) {
            return { table: f.table, field: f.field, outputKey };
        }
    }
    const normalized = raw.startsWith(`${primaryTable}.`) && raw.split(".").length === 2
        ? raw.slice(primaryTable.length + 1)
        : raw;
    if (!normalized.includes(".") &&
        isComputedReportField(primaryTable, normalized)) {
        const match = fields.find((f) => f.table === primaryTable && f.field === normalized);
        return {
            table: primaryTable,
            field: normalized,
            outputKey: match ? (0, report_constants_1.getFieldOutputKey)(match) : normalized,
        };
    }
    return null;
}
function compareSortValues(a, b) {
    if (a == null && b == null) {
        return 0;
    }
    if (a == null) {
        return 1;
    }
    if (b == null) {
        return -1;
    }
    if (typeof a === "number" && typeof b === "number") {
        if (Number.isNaN(a) && Number.isNaN(b)) {
            return 0;
        }
        if (Number.isNaN(a)) {
            return 1;
        }
        if (Number.isNaN(b)) {
            return -1;
        }
        return a - b;
    }
    return String(a).localeCompare(String(b), undefined, {
        numeric: true,
        sensitivity: "base",
    });
}
/** Sort formatted report rows by a column output key (computed / display values). */
function sortFormattedReportRows(rows, outputKey, direction = "asc") {
    const factor = direction === "desc" ? -1 : 1;
    return [...rows].sort((left, right) => {
        const leftValue = left[outputKey] ?? left[`___formatted_${outputKey}`];
        const rightValue = right[outputKey] ?? right[`___formatted_${outputKey}`];
        return factor * compareSortValues(leftValue, rightValue);
    });
}
