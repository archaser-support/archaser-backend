import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";

/**
 * Lambda / external scheduler auth for GET|POST /api/system/cron.
 * Matches monolith: header `x-cron-secret` must equal `CRON_SECRET`.
 * Also accepts `?secret=` / `?cronSecret=` when API Gateway strips custom headers.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
    constructor(private readonly config: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest<Request>();
        const provided = this.extractProvided(req);
        const expected =
            this.config.get<string>("CRON_SECRET") ||
            process.env.CRON_SECRET ||
            "b8638v2eQ7XBL7J3ILNQiFZHVvCAVB3i";

        if (!provided || provided !== expected) {
            throw new UnauthorizedException({
                error: "Unauthorized",
                message: "Missing or invalid x-cron-secret",
            });
        }
        return true;
    }

    private extractProvided(req: Request): string | null {
        const header = req.headers["x-cron-secret"];
        if (typeof header === "string" && header.trim()) {
            return header.trim();
        }
        if (Array.isArray(header) && typeof header[0] === "string") {
            const v = header[0].trim();
            if (v) return v;
        }
        const query = req.query as {
            secret?: string | string[];
            cronSecret?: string | string[];
        };
        for (const key of ["secret", "cronSecret"] as const) {
            const v = query?.[key];
            if (typeof v === "string" && v.trim()) return v.trim();
            if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) {
                return v[0].trim();
            }
        }
        return null;
    }
}
