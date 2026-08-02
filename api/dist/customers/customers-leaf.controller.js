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
exports.CustomersLeafController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const customers_service_1 = require("./customers.service");
let CustomersLeafController = class CustomersLeafController {
    constructor(customers) {
        this.customers = customers;
    }
    async search(user, q, excludeId) {
        return this.customers.searchCustomers(user, {
            q,
            excludeId: excludeId ? parseInt(excludeId, 10) : undefined,
        });
    }
    async aggregatedData(user, customerId) {
        return this.customers.getAggregatedData(user, customerId);
    }
    async validateBusinessUnitAccess(user, body) {
        return this.customers.validateBusinessUnitAccess(user, body.customerNumbers ?? []);
    }
};
exports.CustomersLeafController = CustomersLeafController;
__decorate([
    (0, common_1.Get)("search"),
    (0, swagger_1.ApiOperation)({ summary: "Customer typeahead search" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)("q")),
    __param(2, (0, common_1.Query)("excludeId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], CustomersLeafController.prototype, "search", null);
__decorate([
    (0, common_1.Get)("aggregated-data/:customerId"),
    (0, swagger_1.ApiOperation)({ summary: "Parent customer aggregated child metrics" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)("customerId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CustomersLeafController.prototype, "aggregatedData", null);
__decorate([
    (0, common_1.Post)("validate-business-unit-access"),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({
        summary: "Validate access to customers by customer number (import)",
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CustomersLeafController.prototype, "validateBusinessUnitAccess", null);
exports.CustomersLeafController = CustomersLeafController = __decorate([
    (0, swagger_1.ApiTags)("customers"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/customers"),
    __metadata("design:paramtypes", [customers_service_1.CustomersService])
], CustomersLeafController);
//# sourceMappingURL=customers-leaf.controller.js.map