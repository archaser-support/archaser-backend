import { ReportFilterDto } from "./dto/execute-report.dto";
type PrismaWhere = Record<string, unknown>;
/**
 * Prisma DateTime filters reject bare YYYY-MM-DD ("premature end of input").
 * Match leaves ReportExecutionService.helpers: start-of-day / end-of-day UTC.
 */
export declare function coerceDateTimeBound(value: unknown, bound: "start" | "end"): unknown;
/** Map a report filter operator to a Prisma scalar filter object. */
export declare function operatorToPrisma(operator: string, value: unknown): PrismaWhere | null;
export type SplitFiltersOptions = {
    /** Fields to omit from Prisma where (e.g. expanded __dashboard_* markers). */
    skipFields?: Set<string>;
};
/**
 * Assign a filter clause onto a Prisma where object, expanding dotted paths
 * like `InsurancePolicy.policy_number` into nested relation filters.
 *
 * Nullness on `Relation.scalar` is rewritten to relation presence
 * (`{ isNot: null }` / `{ is: null }`) because required scalars (e.g.
 * InsurancePolicy.policy_number) reject null filters in Prisma 6.
 */
export declare function assignFilterFieldPath(target: PrismaWhere, fieldPath: string, clause: PrismaWhere): void;
/**
 * Build Prisma where clauses for filters that target `primaryTable`.
 * Nested-table filters are returned separately for relation where.
 */
export declare function splitFiltersByTable(filters: ReportFilterDto[], primaryTable: string, options?: SplitFiltersOptions): {
    primary: PrismaWhere;
    nested: Record<string, PrismaWhere>;
};
export declare function mergeAndWhere(...parts: Array<PrismaWhere | undefined | null>): PrismaWhere;
export {};
