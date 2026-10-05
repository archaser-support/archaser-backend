import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class LoginResponseDto {
    @ApiProperty()
    access_token!: string;

    @ApiProperty({ example: "Bearer" })
    token_type!: string;
}

export class MeResponseDto {
    @ApiProperty()
    sub!: string;

    @ApiProperty()
    username!: string;

    @ApiProperty({ required: false, nullable: true })
    email?: string | null;

    @ApiProperty({ required: false, nullable: true })
    account_id?: number | null;

    @ApiProperty({ required: false, nullable: true })
    role?: string | null;

    @ApiProperty({ required: false, nullable: true })
    name?: string | null;

    @ApiProperty({ required: false, nullable: true })
    language?: string | null;

    @ApiProperty({ required: false, nullable: true })
    timezone?: string | null;

    @ApiProperty({ required: false, nullable: true })
    locale?: string | null;

    @ApiProperty({ required: false, nullable: true })
    account_name?: string | null;

    @ApiProperty({ required: false, nullable: true })
    primary_color?: string | null;

    @ApiProperty({ required: false, nullable: true })
    secondary_color?: string | null;

    @ApiProperty({ required: false, nullable: true })
    chart_palette_color?: string | null;

    @ApiProperty({ required: false, nullable: true })
    currency?: string | null;

    @ApiProperty({ required: false, nullable: true })
    sidebar_collapsed?: boolean | null;

    @ApiProperty({
        required: false,
        description: "Effective account collection product (view-as aware)",
    })
    has_collection?: boolean;

    @ApiProperty({
        required: false,
        description: "Effective account credit-insurance product (view-as aware)",
    })
    has_credit_insurance?: boolean;

    @ApiProperty({
        required: false,
        description: "Effective account demo flag (view-as aware)",
    })
    is_demo?: boolean;

    @ApiProperty({
        required: false,
        nullable: true,
        description: "Effective account last ERP sync time (view-as aware)",
    })
    last_sync_date?: string | null;

    @ApiProperty({
        required: false,
        nullable: true,
        description: "Set when view-as is active; logged-in sub stays stable",
    })
    effective_user_id?: string | null;

    @ApiProperty({ required: false, nullable: true })
    effective_account_id?: number | null;

    @ApiProperty({ required: false, nullable: true })
    effective_role?: string | null;
}

export class AccountBySubdomainResponseDto {
    @ApiProperty()
    accountId!: number;

    @ApiProperty()
    name!: string;

    @ApiProperty()
    ssoEnabled!: boolean;

    @ApiProperty({ type: [String] })
    ssoProviders!: string[];
}

export class ScopeProbeResponseDto {
    @ApiProperty()
    ok!: boolean;

    @ApiProperty()
    account_id!: number;
}

export class ForgetPasswordDto {
    @ApiProperty()
    @IsEmail()
    email!: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    language?: string;
}

export class ResetPasswordDto {
    @ApiProperty()
    @IsString()
    token!: string;

    @ApiProperty()
    @IsString()
    @MinLength(8)
    password!: string;
}

export class MessageResponseDto {
    @ApiProperty()
    message!: string;
}
