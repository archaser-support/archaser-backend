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
exports.SmsWebhookController = exports.SmsCountryVendorsController = exports.SmsVendorsController = exports.SmsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const sms_service_1 = require("./sms.service");
let SmsController = class SmsController {
    constructor(sms) {
        this.sms = sms;
    }
    async checkBlocking(user, countryIdRaw, accountIdRaw) {
        const countryId = Number(countryIdRaw);
        if (!Number.isFinite(countryId)) {
            return { error: "Valid country ID is required" };
        }
        const accountId = accountIdRaw && !Number.isNaN(Number(accountIdRaw))
            ? Number(accountIdRaw)
            : undefined;
        return this.sms.checkBlocking(user, countryId, accountId);
    }
    async checkBlockingWithActivities(user, countryIdRaw, accountIdRaw, customerIdRaw) {
        const countryId = Number(countryIdRaw);
        const accountId = Number(accountIdRaw);
        const customerId = Number(customerIdRaw);
        if (!Number.isFinite(countryId)) {
            return { error: "Valid country ID is required" };
        }
        if (!Number.isFinite(accountId) || !Number.isFinite(customerId)) {
            return { error: "Valid customer ID is required" };
        }
        return this.sms.checkBlockingWithActivities(user, countryId, accountId, customerId);
    }
    async test(user, body) {
        return this.sms.testSms(user, body);
    }
};
exports.SmsController = SmsController;
__decorate([
    (0, common_1.Get)("check-blocking"),
    (0, swagger_1.ApiOperation)({ summary: "Check if SMS is blocked for a country" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)("countryId")),
    __param(2, (0, common_1.Query)("accountId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], SmsController.prototype, "checkBlocking", null);
__decorate([
    (0, common_1.Get)("check-blocking-with-activities"),
    (0, swagger_1.ApiOperation)({
        summary: "Check SMS blocking and existing SMS activities",
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)("countryId")),
    __param(2, (0, common_1.Query)("accountId")),
    __param(3, (0, common_1.Query)("customerId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], SmsController.prototype, "checkBlockingWithActivities", null);
__decorate([
    (0, common_1.Post)("test"),
    (0, swagger_1.ApiOperation)({ summary: "Send a test SMS (Nest-native stub)" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SmsController.prototype, "test", null);
exports.SmsController = SmsController = __decorate([
    (0, swagger_1.ApiTags)("sms"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/sms"),
    __metadata("design:paramtypes", [sms_service_1.SmsService])
], SmsController);
let SmsVendorsController = class SmsVendorsController {
    constructor(sms) {
        this.sms = sms;
    }
    async list(user, query) {
        return this.sms.listVendors(user, query);
    }
    async create(user, body) {
        return this.sms.createVendor(user, body);
    }
    async byId(user, id) {
        return this.sms.getVendor(user, id);
    }
    async update(user, id, body) {
        return this.sms.updateVendor(user, id, body);
    }
    async remove(user, id) {
        return this.sms.deleteVendor(user, id);
    }
};
exports.SmsVendorsController = SmsVendorsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "List SMS vendors" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SmsVendorsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: "Create SMS vendor" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SmsVendorsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Get SMS vendor" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], SmsVendorsController.prototype, "byId", null);
__decorate([
    (0, common_1.Put)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Update SMS vendor" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], SmsVendorsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Delete SMS vendor" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], SmsVendorsController.prototype, "remove", null);
exports.SmsVendorsController = SmsVendorsController = __decorate([
    (0, swagger_1.ApiTags)("sms-vendors"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/sms/vendors"),
    __metadata("design:paramtypes", [sms_service_1.SmsService])
], SmsVendorsController);
let SmsCountryVendorsController = class SmsCountryVendorsController {
    constructor(sms) {
        this.sms = sms;
    }
    async list(user, query) {
        return this.sms.listCountryVendors(user, query);
    }
    async create(user, body) {
        return this.sms.createCountryVendor(user, body);
    }
    async byId(user, id) {
        return this.sms.getCountryVendor(user, id);
    }
    async update(user, id, body) {
        return this.sms.updateCountryVendor(user, id, body);
    }
    async remove(user, id) {
        return this.sms.deleteCountryVendor(user, id);
    }
};
exports.SmsCountryVendorsController = SmsCountryVendorsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: "List country–vendor mappings" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SmsCountryVendorsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: "Create country–vendor mapping" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SmsCountryVendorsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Get country–vendor mapping" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], SmsCountryVendorsController.prototype, "byId", null);
__decorate([
    (0, common_1.Put)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Update country–vendor mapping" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], SmsCountryVendorsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, swagger_1.ApiOperation)({ summary: "Delete country–vendor mapping" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], SmsCountryVendorsController.prototype, "remove", null);
exports.SmsCountryVendorsController = SmsCountryVendorsController = __decorate([
    (0, swagger_1.ApiTags)("sms-country-vendors"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/sms/country-vendors"),
    __metadata("design:paramtypes", [sms_service_1.SmsService])
], SmsCountryVendorsController);
let SmsWebhookController = class SmsWebhookController {
    constructor(sms) {
        this.sms = sms;
    }
    async twilio(body) {
        return this.sms.handleTwilioWebhook(body);
    }
};
exports.SmsWebhookController = SmsWebhookController;
__decorate([
    (0, common_1.Post)("twilio"),
    (0, swagger_1.ApiOperation)({ summary: "Twilio SMS delivery webhook (public)" }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SmsWebhookController.prototype, "twilio", null);
exports.SmsWebhookController = SmsWebhookController = __decorate([
    (0, swagger_1.ApiTags)("sms-webhook"),
    (0, common_1.Controller)("api/sms/webhook"),
    __metadata("design:paramtypes", [sms_service_1.SmsService])
], SmsWebhookController);
//# sourceMappingURL=sms.controllers.js.map