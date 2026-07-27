import { IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class LoginDto {
    @ApiProperty({ example: "demo.user" })
    @IsString()
    @MinLength(1)
    username!: string;

    @ApiProperty({ example: "secret" })
    @IsString()
    @MinLength(1)
    password!: string;
}
