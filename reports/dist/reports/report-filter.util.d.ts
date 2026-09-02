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
 * Build Prisma where clauses for filters that target `primaryTable`.
 * Nested-table filters are returned separately for relation where.
 */
export declare function splitFiltersByTable(filters: ReportFilterDto[], primaryTable: string, options?: SplitFiltersOptions): {
    primary: PrismaWhere;
    nested: Record<string, PrismaWhere>;
};
export declare function mergeAndWhere(...parts: Array<PrismaWhere | undefined | null>): PrismaWhere;
export {};
