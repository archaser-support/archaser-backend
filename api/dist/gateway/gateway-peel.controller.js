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
exports.GatewayPeelController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const gateway_proxy_service_1 = require("./gateway-proxy.service");
let GatewayPeelController = class GatewayPeelController {
    constructor(proxy) {
        this.proxy = proxy;
    }
    async smsSend(body, res) {
        const result = await this.proxy.forward("sms", "/internal/send", {
            method: "POST",
            body: JSON.stringify(body ?? {}),
        });
        res.status(result.status).json(result.body);
    }
    async connectorSync(accountId, body, res) {
        const result = await this.proxy.forward("connectors", `/internal/accounts/${accountId}/sync`, { method: "POST", body: JSON.stringify(body ?? {}) });
        res.status(result.status).json(result.body);
    }
    async reportExecute(id, body, res) {
        const result = await this.proxy.forward("reports", `/internal/reports/${id}/execute`, { method: "POST", body: JSON.stringify(body ?? {}) });
        res.status(result.status).json(result.body);
    }
};
exports.GatewayPeelController = GatewayPeelController;
__decorate([
    (0, common_1.Post)("sms/send"),
    (0, swagger_1.ApiOperation)({ summary: "Forward SMS send to archaser-sms when configured" }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], GatewayPeelController.prototype, "smsSend", null);
__decorate([
    (0, common_1.Post)("connectors/:accountId/sync"),
    (0, swagger_1.ApiOperation)({ summary: "Forward connector sync to archaser-connectors" }),
    __param(0, (0, common_1.Param)("accountId")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], GatewayPeelController.prototype, "connectorSync", null);
__decorate([
    (0, common_1.Post)("reports/:id/execute"),
    (0, swagger_1.ApiOperation)({ summary: "Forward report execute to archaser-reports" }),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], GatewayPeelController.prototype, "reportExecute", null);
exports.GatewayPeelController = GatewayPeelController = __decorate([
    (0, swagger_1.ApiTags)("gateway-peel"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/gateway"),
    __metadata("design:paramtypes", [gateway_proxy_service_1.GatewayProxyService])
], GatewayPeelController);
//# sourceMappingURL=gateway-peel.controller.js.map