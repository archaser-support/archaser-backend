import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AccountAdminEntitiesModule } from "./account-admin/account-admin-entities.module";
import { ActivitiesModule } from "./activities/activities.module";
import { AdminModule } from "./admin/admin.module";
import { AgentsModule } from "./agents/agents.module";
import { AuthModule } from "./auth/auth.module";
import { BusinessUnitsModule } from "./business-units/business-units.module";
import { CommunicationIntelligenceModule } from "./communication-intelligence/communication-intelligence.module";
import { ContactsCollectionPeriodModule } from "./contacts/contacts-collection-period.module";
import { CreditInsuranceModule } from "./credit-insurance/credit-insurance.module";
import { CustomersModule } from "./customers/customers.module";
import { DatabaseModule } from "./database/database.module";
import { EmailModule } from "./email/email.module";
import { ErrorsModule } from "./errors/errors.module";
import { GatewayModule } from "./gateway/gateway.module";
import { HealthModule } from "./health/health.module";
import { ImportModule } from "./import/import.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { LogsModule } from "./logs/logs.module";
import { MetricsModule } from "./metrics/metrics.module";
import { OperationsModule } from "./operations/operations.module";
import { PermissionsModule } from "./permissions/permissions.module";
import { PlatformLeavesModule } from "./platform-leaves/platform-leaves.module";
import { PortalModule } from "./portal/portal.module";
import { QueueModule } from "./queue/queue.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { ReferenceDataModule } from "./reference-data/reference-data.module";
import { RolesModule } from "./roles/roles.module";
import { SearchModule } from "./search/search.module";
import { SettingsModule } from "./settings/settings.module";
import { SystemModule } from "./system/system.module";
import { UploadModule } from "./upload/upload.module";
import { UserPreferencesModule } from "./user-preferences/user-preferences.module";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [".env", "../.env"],
        }),
        DatabaseModule,
        HealthModule,
        AuthModule,
        MetricsModule,
        GatewayModule,
        RealtimeModule,
        QueueModule,
        CustomersModule,
        BusinessUnitsModule,
        InvoicesModule,
        ContactsCollectionPeriodModule,
        AccountAdminEntitiesModule,
        // Peeled: sms → @archaser/sms; accounts-nested → @archaser/connectors; reports → @archaser/reports
        PermissionsModule,
        RolesModule,
        SearchModule,
        ActivitiesModule,
        OperationsModule,
        AgentsModule,
        ErrorsModule,
        LogsModule,
        UploadModule,
        SettingsModule,
        UserPreferencesModule,
        AdminModule,
        EmailModule,
        CommunicationIntelligenceModule,
        ReferenceDataModule,
        PlatformLeavesModule,
        ImportModule,
        CreditInsuranceModule,
        PortalModule,
        SystemModule,
    ],
})
export class AppModule {}
