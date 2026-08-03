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
exports.CronSecretGuard = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let CronSecretGuard = class CronSecretGuard {
    constructor(config) {
        this.config = config;
    }
    canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const provided = this.extractProvided(req);
        const expected = this.config.get("CRON_SECRET") ||
            process.env.CRON_SECRET ||
            "b8638v2eQ7XBL7J3ILNQiFZHVvCAVB3i";
        if (!provided || provided !== expected) {
            throw new common_1.UnauthorizedException({
                error: "Unauthorized",
                message: "Missing or invalid x-cron-secret",
            });
        }
        return true;
    }
    extractProvided(req) {
        const header = req.headers["x-cron-secret"];
        if (typeof header === "string" && header.trim()) {
            return header.trim();
        }
        if (Array.isArray(header) && typeof header[0] === "string") {
            const v = header[0].trim();
            if (v)
                return v;
        }
        const query = req.query;
        for (const key of ["secret", "cronSecret"]) {
            const v = query?.[key];
            if (typeof v === "string" && v.trim())
                return v.trim();
            if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) {
                return v[0].trim();
            }
        }
        return null;
    }
};
exports.CronSecretGuard = CronSecretGuard;
exports.CronSecretGuard = CronSecretGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], CronSecretGuard);
//# sourceMappingURL=cron-secret.guard.js.map