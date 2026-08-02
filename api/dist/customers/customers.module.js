"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomersModule = void 0;
const common_1 = require("@nestjs/common");
const auth_module_1 = require("../auth/auth.module");
const database_module_1 = require("../database/database.module");
const customer_checkpoint_service_1 = require("./customer-checkpoint.service");
const customers_leaf_controller_1 = require("./customers-leaf.controller");
const customers_controller_1 = require("./customers.controller");
const customers_service_1 = require("./customers.service");
let CustomersModule = class CustomersModule {
};
exports.CustomersModule = CustomersModule;
exports.CustomersModule = CustomersModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, database_module_1.DatabaseModule],
        controllers: [customers_controller_1.CustomersController, customers_leaf_controller_1.CustomersLeafController],
        providers: [customers_service_1.CustomersService, customer_checkpoint_service_1.CustomerCheckpointService],
        exports: [customers_service_1.CustomersService],
    })
], CustomersModule);
//# sourceMappingURL=customers.module.js.map