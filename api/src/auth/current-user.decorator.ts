import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { DualAuthRequest } from "./dual-auth.guard";
import { JwtPayload } from "./auth.service";

/**
 * Authenticated user from DualAuthGuard (`req.user`).
 */
export const CurrentUser = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): JwtPayload => {
        const req = ctx.switchToHttp().getRequest<DualAuthRequest>();
        if (!req.user) {
            throw new Error("CurrentUser requires DualAuthGuard");
        }
        return req.user;
    }
);
