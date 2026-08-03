import { CanActivate, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
/**
 * Machine-to-machine auth for /internal/* (D33, D43).
 * Header: x-internal-service-secret === INTERNAL_SERVICE_SECRET
 */
export declare class InternalSecretGuard implements CanActivate {
    private readonly config;
    constructor(config: ConfigService);
    canActivate(context: ExecutionContext): boolean;
}
