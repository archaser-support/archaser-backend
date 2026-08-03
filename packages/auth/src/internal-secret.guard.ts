import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";

/**
 * Machine-to-machine auth for /internal/* (D33, D43).
 * Header: x-internal-service-secret === INTERNAL_SERVICE_SECRET
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
    constructor(private readonly config: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest<Request>();
        const expected =
            this.config.get<string>("INTERNAL_SERVICE_SECRET") ||
            process.env.INTERNAL_SERVICE_SECRET ||
            "";
        if (!expected) {
            throw new UnauthorizedException(
                "INTERNAL_SERVICE_SECRET is not configured"
            );
        }
        const header = req.headers["x-internal-service-secret"];
        const provided = Array.isArray(header) ? header[0] : header;
        if (!provided || provided !== expected) {
            throw new UnauthorizedException("Invalid internal service secret");
        }
        return true;
    }
}
