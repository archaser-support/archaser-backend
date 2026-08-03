import { CanActivate, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
/**
 * Lambda / external scheduler auth for GET|POST /api/system/cron.
 * Matches monolith: header `x-cron-secret` must equal `CRON_SECRET`.
 * Also accepts `?secret=` / `?cronSecret=` when API Gateway strips custom headers.
 */
export declare class CronSecretGuard implements CanActivate {
    private readonly config;
    constructor(config: ConfigService);
    canActivate(context: ExecutionContext): boolean;
    private extractProvided;
}
