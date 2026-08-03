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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalSmsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const internal_secret_guard_1 = require("../auth/internal-secret.guard");
const sms_service_1 = require("../sms/sms.service");
let InternalSmsController = class InternalSmsController {
    constructor(sms) {
        this.sms = sms;
    }
    async send(body) {
        return this.sms.sendInternal(body);
    }
};
exports.InternalSmsController = InternalSmsController;
__decorate([
    (0, common_1.Post)("send"),
    (0, swagger_1.ApiOperation)({
        summary: "Service-to-service SMS send (x-internal-service-secret)",
    }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InternalSmsController.prototype, "send", null);
exports.InternalSmsController = InternalSmsController = __decorate([
    (0, swagger_1.ApiTags)("internal-sms"),
    (0, common_1.UseGuards)(internal_secret_guard_1.InternalSecretGuard),
    (0, common_1.Controller)("internal/sms"),
    __metadata("design:paramtypes", [sms_service_1.SmsService])
], InternalSmsController);
