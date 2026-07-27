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
exports.CreditInsuranceDomainController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const credit_insurance_service_1 = require("./credit-insurance.service");
const CREDIT_INSURANCE_KEYS = [
    "summary",
    "summary-history",
    "portfolio-health",
    "customer-dashboard-kpis",
    "customer-policy-trend",
    "report",
    "insurance-policy-trend",
    "mark-reported",
    "mark-reported-bulk",
];
let CreditInsuranceDomainController = class CreditInsuranceDomainController {
    constructor(creditInsurance) {
        this.creditInsurance = creditInsurance;
    }
    async handle(leaf, user, query, body) {
        return this.creditInsurance.handle(leaf, user, query, body);
    }
};
exports.CreditInsuranceDomainController = CreditInsuranceDomainController;
__decorate([
    (0, common_1.All)(":leaf"),
    (0, swagger_1.ApiParam)({
        name: "leaf",
        enum: CREDIT_INSURANCE_KEYS,
        description: "Credit insurance KPI / action leaf",
    }),
    (0, swagger_1.ApiOperation)({
        summary: "Credit insurance KPIs/dashboards (Nest-native)",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, common_1.Param)("leaf")),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __param(2, (0, common_1.Query)()),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], CreditInsuranceDomainController.prototype, "handle", null);
exports.CreditInsuranceDomainController = CreditInsuranceDomainController = __decorate([
    (0, swagger_1.ApiTags)("credit-insurance"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/credit-insurance"),
    __metadata("design:paramtypes", [credit_insurance_service_1.CreditInsuranceService])
], CreditInsuranceDomainController);
//# sourceMappingURL=credit-insurance.controller.js.map