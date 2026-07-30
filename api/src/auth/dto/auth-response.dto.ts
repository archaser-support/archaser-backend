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
    currency?: string | null;

    @ApiProperty({ required: false, nullable: true })
    sidebar_collapsed?: boolean | null;
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
