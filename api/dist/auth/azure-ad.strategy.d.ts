import { ConfigService } from "@nestjs/config";
import { VerifyCallback } from "passport-oauth2";
import { AuthService } from "./auth.service";
declare const AzureAdStrategy_base: new (...args: [options: import("passport-oauth2").StrategyOptionsWithRequest] | [options: import("passport-oauth2").StrategyOptions]) => import("passport-oauth2") & {
    validate(...args: any[]): unknown;
};
export declare class AzureAdStrategy extends AzureAdStrategy_base {
    private readonly authService;
    constructor(configService: ConfigService, authService: AuthService);
    validate(accessToken: string, _refreshToken: string, params: {
        id_token?: string;
    }, done: VerifyCallback): void;
}
export {};
