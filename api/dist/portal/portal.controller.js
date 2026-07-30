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
exports.PortalCustomersDomainController = exports.PortalDomainController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const portal_service_1 = require("./portal.service");
let PortalDomainController = class PortalDomainController {
    constructor(portal) {
        this.portal = portal;
    }
    async createDispute(body) {
        return this.portal.createPublicDispute(body);
    }
    async updatePromise(body) {
        return this.portal.updatePromiseToPay(body);
    }
};
exports.PortalDomainController = PortalDomainController;
__decorate([
    (0, common_1.Post)("create-dispute"),
    (0, swagger_1.ApiOperation)({ summary: "Portal create-dispute (public, Nest-native)" }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PortalDomainController.prototype, "createDispute", null);
__decorate([
    (0, common_1.Post)("update-promise-to-pay"),
    (0, swagger_1.ApiOperation)({
        summary: "Portal update-promise-to-pay (public, Nest-native)",
    }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PortalDomainController.prototype, "updatePromise", null);
exports.PortalDomainController = PortalDomainController = __decorate([
    (0, swagger_1.ApiTags)("portal"),
    (0, common_1.Controller)("api/portal"),
    __metadata("design:paramtypes", [portal_service_1.PortalService])
], PortalDomainController);
const PORTAL_SUFFIXES = [
    "portal-data",
    "agent-portal",
    "invoices",
    "bank-details",
    "banks",
    "disputes",
    "create-dispute",
    "view-disputes",
    "wrong-contact",
];
let PortalCustomersDomainController = class PortalCustomersDomainController {
    constructor(portal) {
        this.portal = portal;
    }
    async publicPortalRoute(customerUUID, suffix, body) {
        return this.portal.handleSuffix(customerUUID, suffix, body);
    }
};
exports.PortalCustomersDomainController = PortalCustomersDomainController;
__decorate([
    (0, common_1.All)(":customerUUID/:suffix"),
    (0, swagger_1.ApiParam)({ name: "customerUUID", description: "Portal customer UUID" }),
    (0, swagger_1.ApiParam)({
        name: "suffix",
        enum: PORTAL_SUFFIXES,
        description: "Public portal leaf",
    }),
    (0, swagger_1.ApiOperation)({
        summary: "Public portal customer UUID routes (Nest-native)",
    }),
    __param(0, (0, common_1.Param)("customerUUID")),
    __param(1, (0, common_1.Param)("suffix")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], PortalCustomersDomainController.prototype, "publicPortalRoute", null);
exports.PortalCustomersDomainController = PortalCustomersDomainController = __decorate([
    (0, swagger_1.ApiTags)("portal-customers"),
    (0, common_1.Controller)("api/customers"),
    __metadata("design:paramtypes", [portal_service_1.PortalService])
], PortalCustomersDomainController);
//# sourceMappingURL=portal.controller.js.map