"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const account_admin_entities_module_1 = require("./account-admin/account-admin-entities.module");
const accounts_nested_module_1 = require("./accounts-nested/accounts-nested.module");
const activities_module_1 = require("./activities/activities.module");
const admin_module_1 = require("./admin/admin.module");
const agents_module_1 = require("./agents/agents.module");
const auth_module_1 = require("./auth/auth.module");
const business_units_module_1 = require("./business-units/business-units.module");
const communication_intelligence_module_1 = require("./communication-intelligence/communication-intelligence.module");
const contacts_collection_period_module_1 = require("./contacts/contacts-collection-period.module");
const credit_insurance_module_1 = require("./credit-insurance/credit-insurance.module");
const customers_module_1 = require("./customers/customers.module");
const database_module_1 = require("./database/database.module");
const email_module_1 = require("./email/email.module");
const errors_module_1 = require("./errors/errors.module");
const gateway_module_1 = require("./gateway/gateway.module");
const health_module_1 = require("./health/health.module");
const import_module_1 = require("./import/import.module");
const invoices_module_1 = require("./invoices/invoices.module");
const logs_module_1 = require("./logs/logs.module");
const metrics_module_1 = require("./metrics/metrics.module");
const operations_module_1 = require("./operations/operations.module");
const permissions_module_1 = require("./permissions/permissions.module");
const platform_leaves_module_1 = require("./platform-leaves/platform-leaves.module");
const portal_module_1 = require("./portal/portal.module");
const queue_module_1 = require("./queue/queue.module");
const realtime_module_1 = require("./realtime/realtime.module");
const reference_data_module_1 = require("./reference-data/reference-data.module");
const reports_module_1 = require("./reports/reports.module");
const roles_module_1 = require("./roles/roles.module");
const search_module_1 = require("./search/search.module");
const settings_module_1 = require("./settings/settings.module");
const sms_module_1 = require("./sms/sms.module");
const system_module_1 = require("./system/system.module");
const upload_module_1 = require("./upload/upload.module");
const user_preferences_module_1 = require("./user-preferences/user-preferences.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: [".env", "../.env"],
            }),
            database_module_1.DatabaseModule,
            health_module_1.HealthModule,
            auth_module_1.AuthModule,
            metrics_module_1.MetricsModule,
            gateway_module_1.GatewayModule,
            realtime_module_1.RealtimeModule,
            queue_module_1.QueueModule,
            customers_module_1.CustomersModule,
            business_units_module_1.BusinessUnitsModule,
            invoices_module_1.InvoicesModule,
            contacts_collection_period_module_1.ContactsCollectionPeriodModule,
            account_admin_entities_module_1.AccountAdminEntitiesModule,
            accounts_nested_module_1.AccountsNestedModule,
            permissions_module_1.PermissionsModule,
            roles_module_1.RolesModule,
            search_module_1.SearchModule,
            activities_module_1.ActivitiesModule,
            operations_module_1.OperationsModule,
            agents_module_1.AgentsModule,
            errors_module_1.ErrorsModule,
            logs_module_1.LogsModule,
            upload_module_1.UploadModule,
            settings_module_1.SettingsModule,
            user_preferences_module_1.UserPreferencesModule,
            sms_module_1.SmsModule,
            admin_module_1.AdminModule,
            email_module_1.EmailModule,
            communication_intelligence_module_1.CommunicationIntelligenceModule,
            reference_data_module_1.ReferenceDataModule,
            platform_leaves_module_1.PlatformLeavesModule,
            import_module_1.ImportModule,
            credit_insurance_module_1.CreditInsuranceModule,
            portal_module_1.PortalModule,
            reports_module_1.ReportsModule,
            system_module_1.SystemModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map