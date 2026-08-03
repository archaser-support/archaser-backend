import { Type } from "class-transformer";
import {
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Max,
    Min,
    ValidateNested,
} from "class-validator";

export class ReportFilterDto {
    @IsString()
    table!: string;

    @IsString()
    field!: string;

    @IsString()
    operator!: string;

    @IsOptional()
    value?: unknown;
}

export class ExecuteReportDto {
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ReportFilterDto)
    filters?: ReportFilterDto[];

    @IsOptional()
    @IsBoolean()
    replaceConfigFilters?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(10000)
    limit?: number;

    @IsOptional()
    @IsString()
    sortField?: string;

    @IsOptional()
    @IsIn(["asc", "desc"])
    sortDirection?: "asc" | "desc";

    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsString()
    locale?: string;

    @IsOptional()
    @IsString()
    language?: string;

    /** Sent by useViewExecution / session; formatting only on Nest side for now. */
    @IsOptional()
    @IsString()
    timezone?: string;

    @IsOptional()
    @IsBoolean()
    includeInvoiceCreditInsuranceViolationFields?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    businessUnitId?: number | null;

    @IsOptional()
    @IsString()
    selectedUserId?: string | null;
}
