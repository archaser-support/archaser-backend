"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SoftDualAuthGuard = void 0;
exports.isPublicPagesApiPath = isPublicPagesApiPath;
const common_1 = require("@nestjs/common");
const dual_auth_guard_1 = require("./dual-auth.guard");
function isPublicPagesApiPath(urlPath) {
    const path = urlPath.split("?")[0];
    const prefixes = [
        "/api/email/",
        "/api/sms/webhook/",
        "/api/auth/",
        "/api/portal/",
        "/api/contact-response",
        "/api/metrics",
        "/api/errors/",
    ];
    if (prefixes.some((p) => path === p.slice(0, -1) || path.startsWith(p))) {
        return true;
    }
    if (/^\/api\/customers\/[^/]+\/(portal-data|agent-portal|invoices|bank-details|banks|disputes|create-dispute|view-disputes|wrong-contact|top-ups)(\/|$)/.test(path)) {
        return true;
    }
    return false;
}
let SoftDualAuthGuard = class SoftDualAuthGuard {
    constructor(dualAuth) {
        this.dualAuth = dualAuth;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const urlPath = req.originalUrl || req.url || "";
        try {
            return await this.dualAuth.canActivate(context);
        }
        catch (error) {
            if (isPublicPagesApiPath(urlPath.split("?")[0])) {
                return true;
            }
            if (error instanceof common_1.UnauthorizedException) {
                throw error;
            }
            throw new common_1.UnauthorizedException("Missing or invalid authentication");
        }
    }
};
exports.SoftDualAuthGuard = SoftDualAuthGuard;
exports.SoftDualAuthGuard = SoftDualAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [dual_auth_guard_1.DualAuthGuard])
], SoftDualAuthGuard);
//# sourceMappingURL=soft-dual-auth.guard.js.map