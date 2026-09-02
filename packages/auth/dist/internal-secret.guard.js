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
exports.InternalSecretGuard = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
/**
 * Machine-to-machine auth for /internal/* (D33, D43).
 * Header: x-internal-service-secret === INTERNAL_SERVICE_SECRET
 */
let InternalSecretGuard = class InternalSecretGuard {
    constructor(config) {
        this.config = config;
    }
    canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const expected = this.config.get("INTERNAL_SERVICE_SECRET") ||
            process.env.INTERNAL_SERVICE_SECRET ||
            "";
        if (!expected) {
            throw new common_1.UnauthorizedException("INTERNAL_SERVICE_SECRET is not configured");
        }
        const header = req.headers["x-internal-service-secret"];
        const provided = Array.isArray(header) ? header[0] : header;
        if (!provided || provided !== expected) {
            throw new common_1.UnauthorizedException("Invalid internal service secret");
        }
        return true;
    }
};
exports.InternalSecretGuard = InternalSecretGuard;
exports.InternalSecretGuard = InternalSecretGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], InternalSecretGuard);
