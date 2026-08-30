/** Calendar-day age past due_date (0 when not yet overdue). */
export declare function calculateDaysOverdue(dueDate: Date | string | null | undefined, now?: Date): number | null;
/** Calendar days until due_date (can be negative if overdue). */
export declare function calculateDaysUntilDue(dueDate: Date | string | null | undefined, now?: Date): number | null;
/** Non-negative calendar days remaining until date (0 when past). */
export declare function calculateDaysLeft(endDate: Date | string | null | undefined, now?: Date): number | null;
export declare function extractTermsBreachReasonCodes(row: {
    reporting_breach?: boolean | null;
    ctv_payment_term?: boolean | null;
    ctv_customer_overdue_mep?: boolean | null;
    ctv_outdated_dcl?: boolean | null;
    ctv_invoice_after_policy_end?: boolean | null;
}): string;
/**
 * Prisma where clause for a filter on a computed report field. Returns null
 * when the field or operator is unsupported, and the caller then drops the
 * filter as before.
 */
export declare function computedFieldToPrismaWhere(table: string, field: string, operator: string, value?: unknown): Record<string, unknown> | null;
/** Filter value codes offered for a computed field, for report metadata. */
export declare function getComputedFieldFilterCodes(table: string, field: string): string[];
export declare function formatTermsBreachReasonForDisplay(codesJoined: string | null | undefined, locale?: string): string;
/** True when `field` is a scalar column on the Prisma model for `reportTable`. */
export declare function isPrismaScalarField(reportTable: string, field: string): boolean;
/**
 * True when `relationField` is a to-many relation on the Prisma model for
 * `reportTable`. Prisma requires `some`/`every`/`none` on list relations, so
 * callers must wrap field filters instead of nesting them directly.
 */
export declare function isPrismaListRelation(reportTable: string, relationField: string): boolean;
/**
 * Expand known computed report fields into real Prisma select keys.
 * Returns true when handled (caller must not select `field` as a scalar).
 */
export declare function applyComputedFieldSelect(primaryTable: string, field: string, select: Record<string, unknown>): boolean;
/**
 * Extract a computed report field value from a loaded Prisma row.
 * Returns `undefined` when the field is not a known computed field.
 */
export declare function extractComputedFieldValue(primaryTable: string, field: string, row: Record<string, unknown>): unknown;
/** True when sorting/filtering by this primary field must not hit Prisma. */
export declare function isComputedReportField(primaryTable: string, field: string): boolean;
