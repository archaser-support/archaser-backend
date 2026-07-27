import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { AuthService, JwtPayload } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { AccountBySubdomainResponseDto, ForgetPasswordDto, LoginResponseDto, MeResponseDto, MessageResponseDto, ResetPasswordDto, ScopeProbeResponseDto } from "./dto/auth-response.dto";
export declare class AuthController {
    private readonly authService;
    private readonly configService;
    constructor(authService: AuthService, configService: ConfigService);
    login(body: LoginDto): Promise<LoginResponseDto>;
    me(req: Request & {
        user: JwtPayload;
    }): Promise<MeResponseDto>;
    forgetPassword(body: ForgetPasswordDto): Promise<MessageResponseDto>;
    resetPassword(body: ResetPasswordDto): Promise<MessageResponseDto>;
    scopeProbe(req: Request & {
        user: JwtPayload;
    }, accountId: number): ScopeProbeResponseDto;
    accountBySubdomain(subdomain?: string): Promise<AccountBySubdomainResponseDto>;
    googleStart(res: Response): Promise<void>;
    googleStartPassport(): void;
    googleCallback(req: Request & {
        user?: {
            email?: string;
        };
    }, res: Response): Promise<void>;
    azureStart(res: Response): Promise<void>;
    azureStartPassport(): void;
    azureCallback(req: Request & {
        user?: {
            email?: string;
        };
    }, res: Response): Promise<void>;
    simulateSso(email: string | undefined, provider: string | undefined, res: Response): Promise<void>;
    private finishSso;
}
