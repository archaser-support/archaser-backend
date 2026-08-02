"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessUnitsModule = void 0;
const common_1 = require("@nestjs/common");
const auth_module_1 = require("../auth/auth.module");
const database_module_1 = require("../database/database.module");
const business_units_controller_1 = require("./business-units.controller");
const business_units_service_1 = require("./business-units.service");
let BusinessUnitsModule = class BusinessUnitsModule {
};
exports.BusinessUnitsModule = BusinessUnitsModule;
exports.BusinessUnitsModule = BusinessUnitsModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, database_module_1.DatabaseModule],
        controllers: [business_units_controller_1.BusinessUnitsController],
        providers: [business_units_service_1.BusinessUnitsService],
        exports: [business_units_service_1.BusinessUnitsService],
    })
], BusinessUnitsModule);
//# sourceMappingURL=business-units.module.js.map