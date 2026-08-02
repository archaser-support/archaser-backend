"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountAdminEntitiesModule = void 0;
const common_1 = require("@nestjs/common");
const auth_module_1 = require("../auth/auth.module");
const database_module_1 = require("../database/database.module");
const account_admin_entities_service_1 = require("./account-admin-entities.service");
const accounts_bank_accounts_controller_1 = require("./accounts-bank-accounts.controller");
const accounts_business_units_controller_1 = require("./accounts-business-units.controller");
const bank_accounts_leaf_controller_1 = require("./bank-accounts-leaf.controller");
const business_unit_banks_controller_1 = require("./business-unit-banks.controller");
const create_account_admin_controller_1 = require("./create-account-admin.controller");
const users_accounts_extras_controller_1 = require("./users-accounts-extras.controller");
const controllers = [
    ...account_admin_entities_service_1.ACCOUNT_ADMIN_ENTITY_TYPES.map((t) => (0, create_account_admin_controller_1.createAccountAdminController)(t)),
    business_unit_banks_controller_1.BusinessUnitBanksController,
    accounts_business_units_controller_1.AccountsBusinessUnitsController,
    accounts_bank_accounts_controller_1.AccountsBankAccountsController,
    bank_accounts_leaf_controller_1.BankAccountsLeafController,
    users_accounts_extras_controller_1.UsersExtrasController,
    users_accounts_extras_controller_1.AccountsExtrasController,
];
let AccountAdminEntitiesModule = class AccountAdminEntitiesModule {
};
exports.AccountAdminEntitiesModule = AccountAdminEntitiesModule;
exports.AccountAdminEntitiesModule = AccountAdminEntitiesModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, database_module_1.DatabaseModule],
        controllers,
        providers: [account_admin_entities_service_1.AccountAdminEntitiesService],
        exports: [account_admin_entities_service_1.AccountAdminEntitiesService],
    })
], AccountAdminEntitiesModule);
//# sourceMappingURL=account-admin-entities.module.js.map