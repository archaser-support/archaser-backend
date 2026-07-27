import { ReportFilterDto } from "./dto/execute-report.dto";
type PrismaWhere = Record<string, unknown>;
export declare function coerceDateTimeBound(value: unknown, bound: "start" | "end"): unknown;
export declare function operatorToPrisma(operator: string, value: unknown): PrismaWhere | null;
export type SplitFiltersOptions = {
    skipFields?: Set<string>;
};
export declare function splitFiltersByTable(filters: ReportFilterDto[], primaryTable: string, options?: SplitFiltersOptions): {
    primary: PrismaWhere;
    nested: Record<string, PrismaWhere>;
};
export declare function mergeAndWhere(...parts: Array<PrismaWhere | undefined | null>): PrismaWhere;
export {};
