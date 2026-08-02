"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditInsuranceModule = void 0;
const common_1 = require("@nestjs/common");
const auth_module_1 = require("../auth/auth.module");
const database_module_1 = require("../database/database.module");
const create_insurance_entity_controller_1 = require("./create-insurance-entity.controller");
const credit_dashboard_access_service_1 = require("./credit-dashboard-access.service");
const credit_insurance_controller_1 = require("./credit-insurance.controller");
const credit_insurance_leaves_service_1 = require("./credit-insurance-leaves.service");
const credit_insurance_service_1 = require("./credit-insurance.service");
const insurance_entities_service_1 = require("./insurance-entities.service");
const insurance_policies_actions_controller_1 = require("./insurance-policies-actions.controller");
const insuranceEntityControllers = insurance_entities_service_1.INSURANCE_ENTITY_TYPES.map((t) => (0, create_insurance_entity_controller_1.createInsuranceEntityController)(t));
let CreditInsuranceModule = class CreditInsuranceModule {
};
exports.CreditInsuranceModule = CreditInsuranceModule;
exports.CreditInsuranceModule = CreditInsuranceModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, database_module_1.DatabaseModule],
        controllers: [
            credit_insurance_controller_1.CreditInsuranceDomainController,
            insurance_policies_actions_controller_1.InsurancePoliciesActionsController,
            ...insuranceEntityControllers,
        ],
        providers: [
            credit_insurance_service_1.CreditInsuranceService,
            credit_insurance_leaves_service_1.CreditInsuranceLeavesService,
            credit_dashboard_access_service_1.CreditDashboardAccessService,
            insurance_entities_service_1.InsuranceEntitiesService,
        ],
        exports: [credit_insurance_service_1.CreditInsuranceService, insurance_entities_service_1.InsuranceEntitiesService],
    })
], CreditInsuranceModule);
//# sourceMappingURL=credit-insurance.module.js.map