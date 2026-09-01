import { Prisma } from "@prisma/client";
import { getCustomerPolicyRow } from "@archaser/credit-insurance-domain";
import { mergeActiveCustomerPolicySelect } from "@archaser/credit-insurance-domain";

/** Report table name → Prisma DMMF model name. */
const REPORT_TABLE_TO_PRISMA_MODEL: Record<string, string> = {
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

const scalarFieldCache = new Map<string, Set<string>>();
const listRelationCache = new Map<string, Set<string>>();

/** Calendar-day age past due_date (0 when not yet overdue). */
export function calculateDaysOverdue(
    dueDate: Date | string | null | undefined,
    now = new Date()
): number | null {
    if (dueDate == null) return null;
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return null;
    return Math.max(
        0,
        Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
    );
}

/** Calendar days until due_date (can be negative if overdue). */
export function calculateDaysUntilDue(
    dueDate: Date | string | null | undefined,
    now = new Date()
): number | null {
    if (dueDate == null) return null;
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return null;
    return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Non-negative calendar days remaining until date (0 when past). */
export function calculateDaysLeft(
    endDate: Date | string | null | undefined,
    now = new Date()
): number | null {
    if (endDate == null) return null;
    const end = new Date(endDate);
    if (Number.isNaN(end.getTime())) return null;
    return Math.max(
        0,
        Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );
}

export function extractTermsBreachReasonCodes(row: {
    reporting_breach?: boolean | null;
    ctv_payment_term?: boolean | null;
    ctv_customer_overdue_mep?: boolean | null;
    ctv_outdated_dcl?: boolean | null;
    ctv_invoice_after_policy_end?: boolean | null;
}): string {
    const codes: string[] = [];
    if (row.reporting_breach) codes.push("reporting_breach");
    if (row.ctv_payment_term) codes.push("ctv_payment_term");
    if (row.ctv_customer_overdue_mep) codes.push("ctv_customer_overdue_mep");
    if (row.ctv_outdated_dcl) codes.push("ctv_outdated_dcl");
    if (row.ctv_invoice_after_policy_end) {
        codes.push("ctv_invoice_after_policy_end");
    }
    return codes.join(" · ");
}

/**
 * A computed field whose value reads as a set of codes, each backed by one
 * boolean column. Presence operators test the whole set; pick-list operators
 * test only the selected subset.
 */
type BooleanSetComputedField = {
    table: string;
    field: string;
    kind: "boolean_set";
    /** Filter value code → boolean column backing it. */
    columnByCode: Record<string, string>;
};

/**
 * Computed report fields have no column of their own, so filters on them must
 * be rewritten against the columns they derive from. The mapping lives here as
 * data so `computedFieldToPrismaWhere` stays generic: supporting another field
 * is a new entry, not another branch.
 */
const COMPUTED_FILTER_MAPPINGS: BooleanSetComputedField[] = [
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

function matchesAnyColumn(columns: string[]): Record<string, unknown> {
    return { OR: columns.map((column) => ({ [column]: true })) };
}

function matchesNoColumn(columns: string[]): Record<string, unknown> {
    // `not: true` also matches NULL, which reads as "flag not set".
    return { AND: columns.map((column) => ({ [column]: { not: true } })) };
}

function parseFilterCodes(value: unknown): string[] {
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
export function computedFieldToPrismaWhere(
    table: string,
    field: string,
    operator: string,
    value?: unknown
): Record<string, unknown> | null {
    const mapping = COMPUTED_FILTER_MAPPINGS.find(
        (candidate) => candidate.table === table && candidate.field === field
    );
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

    const columns = Array.from(
        new Set(
            parseFilterCodes(value)
                .map((code) => mapping.columnByCode[code])
                .filter((column): column is string => !!column)
        )
    );
    // An empty or unrecognised selection carries no intent; drop it rather
    // than match nothing.
    if (columns.length === 0) {
        return null;
    }
    return isAnyOf ? matchesAnyColumn(columns) : matchesNoColumn(columns);
}

/** Filter value codes offered for a computed field, for report metadata. */
export function getComputedFieldFilterCodes(
    table: string,
    field: string
): string[] {
    const mapping = COMPUTED_FILTER_MAPPINGS.find(
        (candidate) => candidate.table === table && candidate.field === field
    );
    return mapping ? Object.keys(mapping.columnByCode) : [];
}

const TERMS_BREACH_CODE_TO_CAUSE: Record<string, string> = {
    reporting_breach: "reporting_breach",
    ctv_payment_term: "payment_term",
    ctv_customer_overdue_mep: "customer_overdue_mep",
    ctv_outdated_dcl: "outdated_dcl",
    ctv_invoice_after_policy_end: "invoice_after_policy_end",
};

// Wording mirrors locales/{en,he}/invoices.json so the report cell and the
// filter pick-list name each reason identically.
const TERMS_BREACH_CAUSE_LABELS: Record<"en" | "he", Record<string, string>> = {
    en: {
        reporting_breach: "Reporting Breach",
        payment_term: "Terms violation at creation (payment term)",
        customer_overdue_mep:
            "Terms violation at creation (customer overdue MEP)",
        outdated_dcl: "Terms violation at creation (outdated DCL)",
        invoice_after_policy_end:
            "Terms violation at creation (invoice after policy end)",
    },
    he: {
        reporting_breach: "חריגת דיווח",
        payment_term: "הפרת תנאים בעת יצירה (תנאי תשלום)",
        customer_overdue_mep: "הפרת תנאים בעת יצירה (לקוח בפיגור MEP)",
        outdated_dcl: "הפרת תנאים בעת יצירה (DCL לא עדכני)",
        invoice_after_policy_end:
            "הפרת תנאים בעת יצירה (חשבונית לאחר סיום הפוליסה)",
    },
};

export function formatTermsBreachReasonForDisplay(
    codesJoined: string | null | undefined,
    locale?: string
): string {
    if (codesJoined == null || String(codesJoined).trim() === "") {
        return "";
    }
    const language = (locale?.split("-")[0] === "he" ? "he" : "en") as
        | "en"
        | "he";
    const labels = TERMS_BREACH_CAUSE_LABELS[language];
    return String(codesJoined)
        .split(" · ")
        .map((code) => {
            const trimmed = code.trim();
            if (!trimmed) return "";
            const causeKey = TERMS_BREACH_CODE_TO_CAUSE[trimmed] ?? trimmed;
            return labels[causeKey] ?? trimmed;
        })
        .filter(Boolean)
        .join(" · ");
}

/** True when `field` is a scalar column on the Prisma model for `reportTable`. */
export function isPrismaScalarField(
    reportTable: string,
    field: string
): boolean {
    if (!field || field.includes(".") || field.startsWith("__")) {
        return false;
    }
    const modelName = REPORT_TABLE_TO_PRISMA_MODEL[reportTable];
    if (!modelName) {
        return false;
    }
    let scalars = scalarFieldCache.get(modelName);
    if (!scalars) {
        const model = Prisma.dmmf.datamodel.models.find(
            (m) => m.name === modelName
        );
        scalars = new Set(
            (model?.fields || [])
                .filter((f) => f.kind === "scalar" || f.kind === "enum")
                .map((f) => f.name)
        );
        scalarFieldCache.set(modelName, scalars);
    }
    return scalars.has(field);
}

/**
 * True when `relationField` is a to-many relation on the Prisma model for
 * `reportTable`. Prisma requires `some`/`every`/`none` on list relations, so
 * callers must wrap field filters instead of nesting them directly.
 */
export function isPrismaListRelation(
    reportTable: string,
    relationField: string
): boolean {
    const modelName = REPORT_TABLE_TO_PRISMA_MODEL[reportTable];
    if (!modelName) {
        return false;
    }
    let lists = listRelationCache.get(modelName);
    if (!lists) {
        const model = Prisma.dmmf.datamodel.models.find(
            (m) => m.name === modelName
        );
        lists = new Set(
            (model?.fields || [])
                .filter((f) => f.kind === "object" && f.isList)
                .map((f) => f.name)
        );
        listRelationCache.set(modelName, lists);
    }
    return lists.has(relationField);
}

/**
 * Expand known computed report fields into real Prisma select keys.
 * Returns true when handled (caller must not select `field` as a scalar).
 */
export function applyComputedFieldSelect(
    primaryTable: string,
    field: string,
    select: Record<string, unknown>
): boolean {
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
            mergeActiveCustomerPolicySelect(select, [
                "approved_limit_expiration_date",
            ]);
            return true;
        }
        if (field === "company_number") {
            select.Company = {
                select: {
                    ...(
                        (select.Company as { select?: Record<string, unknown> })
                            ?.select || {}
                    ),
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
export function extractComputedFieldValue(
    primaryTable: string,
    field: string,
    row: Record<string, unknown>
): unknown {
    if (primaryTable === "Invoice") {
        if (field === "days_overdue") {
            return calculateDaysOverdue(
                row.due_date as Date | string | null | undefined
            );
        }
        if (field === "days_until_due") {
            return calculateDaysUntilDue(
                row.due_date as Date | string | null | undefined
            );
        }
        if (field === "days_left_for_reporting") {
            return calculateDaysLeft(
                row.target_reporting_date as Date | string | null | undefined
            );
        }
        if (field === "terms_breach_reason") {
            return extractTermsBreachReasonCodes(
                row as Parameters<typeof extractTermsBreachReasonCodes>[0]
            );
        }
        return undefined;
    }

    if (primaryTable === "Customer") {
        if (field === "days_overdue") {
            return calculateDaysOverdue(
                row.oldest_invoice_overdue_date as
                    | Date
                    | string
                    | null
                    | undefined
            );
        }
        if (field === "limit_expires_in_days") {
            const policy = getCustomerPolicyRow(row);
            return calculateDaysLeft(
                (policy?.approved_limit_expiration_date as
                    | Date
                    | string
                    | null
                    | undefined) ?? null
            );
        }
        if (field === "company_number") {
            const company = row.Company as
                | { company_number?: string | null }
                | null
                | undefined;
            return company?.company_number ?? null;
        }
        if (field === "open_receivable_amount") {
            const raw = row.open_receivable_amount;
            if (raw === null || raw === undefined) {
                return undefined;
            }
            if (typeof raw === "number") {
                return Number.isNaN(raw) ? null : raw;
            }
            if (typeof raw === "object" && raw !== null && "toNumber" in raw) {
                try {
                    const n = (raw as { toNumber: () => number }).toNumber();
                    return Number.isFinite(n) ? n : null;
                } catch {
                    return null;
                }
            }
            const n = parseFloat(String(raw));
            return Number.isNaN(n) ? null : n;
        }
        return undefined;
    }

    return undefined;
}

/** True when sorting/filtering by this primary field must not hit Prisma. */
export function isComputedReportField(
    primaryTable: string,
    field: string
): boolean {
    if (primaryTable === "Invoice") {
        return (
            field === "days_overdue" ||
            field === "days_until_due" ||
            field === "days_left_for_reporting" ||
            field === "terms_breach_reason"
        );
    }
    if (primaryTable === "Customer") {
        return (
            field === "days_overdue" ||
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
            field === "top_up_days_left"
        );
    }
    if (primaryTable === "Activity") {
        return field === "call_time" || field === "call_direction";
    }
    if (primaryTable === "Dispute") {
        return (
            field === "dispute_number" ||
            field === "assigned_to" ||
            field === "dispute_reason" ||
            field === "amount_in_dispute" ||
            field === "days_past_due"
        );
    }
    return false;
}
