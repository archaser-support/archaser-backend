"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactsCollectionPeriodModule = void 0;
const common_1 = require("@nestjs/common");
const auth_module_1 = require("../auth/auth.module");
const database_module_1 = require("../database/database.module");
const collection_period_controller_1 = require("./collection-period.controller");
const collection_period_service_1 = require("./collection-period.service");
const contacts_controller_1 = require("./contacts.controller");
const contacts_service_1 = require("./contacts.service");
let ContactsCollectionPeriodModule = class ContactsCollectionPeriodModule {
};
exports.ContactsCollectionPeriodModule = ContactsCollectionPeriodModule;
exports.ContactsCollectionPeriodModule = ContactsCollectionPeriodModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, database_module_1.DatabaseModule],
        controllers: [contacts_controller_1.ContactsController, collection_period_controller_1.CollectionPeriodController],
        providers: [contacts_service_1.ContactsService, collection_period_service_1.CollectionPeriodService],
        exports: [contacts_service_1.ContactsService, collection_period_service_1.CollectionPeriodService],
    })
], ContactsCollectionPeriodModule);
//# sourceMappingURL=contacts-collection-period.module.js.map