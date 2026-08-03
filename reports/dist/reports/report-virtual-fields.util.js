"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDaysOverdue = calculateDaysOverdue;
exports.calculateDaysUntilDue = calculateDaysUntilDue;
exports.calculateDaysLeft = calculateDaysLeft;
exports.extractTermsBreachReasonCodes = extractTermsBreachReasonCodes;
exports.formatTermsBreachReasonForDisplay = formatTermsBreachReasonForDisplay;
exports.isPrismaScalarField = isPrismaScalarField;
exports.isPrismaListRelation = isPrismaListRelation;
exports.applyComputedFieldSelect = applyComputedFieldSelect;
exports.extractComputedFieldValue = extractComputedFieldValue;
exports.isComputedReportField = isComputedReportField;
const client_1 = require("@prisma/client");
const report_customer_policy_fields_util_1 = require("./report-customer-policy-fields.util");
const report_customer_policy_fields_util_2 = require("./report-customer-policy-fields.util");
/** Report table name → Prisma DMMF model name. */
const REPORT_TABLE_TO_PRISMA_MODEL = {
    Customer: "Customer",
    Invoice: "Invoice",
    Payment: "Payment",
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
const TERMS_BREACH_CODE_TO_CAUSE = {
    reporting_breach: "reporting_breach",
    ctv_payment_term: "payment_term",
    ctv_customer_overdue_mep: "customer_overdue_mep",
    ctv_outdated_dcl: "outdated_dcl",
    ctv_invoice_after_policy_end: "invoice_after_policy_end",
};
const TERMS_BREACH_CAUSE_LABELS = {
    en: {
        reporting_breach: "Reporting breach",
        payment_term: "Payment term violation",
        customer_overdue_mep: "Customer overdue (MEP) at creation",
        outdated_dcl: "Outdated DCL at creation",
        invoice_after_policy_end: "Invoice dated after policy end",
    },
    he: {
        reporting_breach: "חריגת דיווח",
        payment_term: "הפרת תנאי תשלום",
        customer_overdue_mep: "לקוח בפיגור MEP בעת יצירה",
        outdated_dcl: "DCL לא עדכני בעת יצירה",
        invoice_after_policy_end: "חשבונית לאחר סיום הפוליסה",
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
            (0, report_customer_policy_fields_util_2.mergeActiveCustomerPolicySelect)(select, [
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
            const policy = (0, report_customer_policy_fields_util_1.getCustomerPolicyRow)(row);
            return calculateDaysLeft(policy?.approved_limit_expiration_date ?? null);
        }
        if (field === "company_number") {
            const company = row.Company;
            return company?.company_number ?? null;
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
            field === "limit_warning_summary" ||
            field === "top_up_type" ||
            field === "top_up_value" ||
            field === "top_up_resolved_amount" ||
            field === "top_up_end_date" ||
            field === "top_up_days_left");
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
