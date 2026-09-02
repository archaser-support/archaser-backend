"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentUser = void 0;
const common_1 = require("@nestjs/common");
/**
 * Authenticated user from DualAuthGuard (`req.user`).
 */
exports.CurrentUser = (0, common_1.createParamDecorator)((_data, ctx) => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.user) {
        throw new Error("CurrentUser requires DualAuthGuard");
    }
    return req.user;
});
