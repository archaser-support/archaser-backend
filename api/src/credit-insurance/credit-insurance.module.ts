import { Module, type OnModuleInit } from "@nestjs/common";
import { registerArPostIngestOrchestrator } from "@archaser/billing-connector";
import {
    bindCreditInsurancePrisma,
    registerCreditAsOfBackfillDispatch,
} from "@archaser/credit-insurance-domain";
import { runArPostIngestForCustomers } from "@archaser/cron-jobs";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DatabaseService } from "../database/database.service";
import { QueueModule } from "../queue/queue.module";
import { CronQueueService } from "../queue/cron-queue.service";
import { AsOfBackfillController } from "./as-of-backfill.controller";
import { createInsuranceEntityController } from "./create-insurance-entity.controller";
import { CreditDashboardAccessService } from "./credit-dashboard-access.service";
import { CreditInsuranceDomainController } from "./credit-insurance.controller";
import { CreditInsuranceLeavesService } from "./credit-insurance-leaves.service";
import { CreditInsuranceService } from "./credit-insurance.service";
import {
    INSURANCE_ENTITY_TYPES,
    InsuranceEntitiesService,
} from "./insurance-entities.service";
import { InsurancePoliciesActionsController } from "./insurance-policies-actions.controller";

const insuranceEntityControllers = INSURANCE_ENTITY_TYPES.map((t) =>
    createInsuranceEntityController(t)
);

@Module({
    imports: [AuthModule, DatabaseModule, QueueModule],
    controllers: [
        CreditInsuranceDomainController,
        AsOfBackfillController,
        InsurancePoliciesActionsController,
        ...insuranceEntityControllers,
    ],
    providers: [
        CreditInsuranceService,
        CreditInsuranceLeavesService,
        CreditDashboardAccessService,
        InsuranceEntitiesService,
    ],
    exports: [CreditInsuranceService, InsuranceEntitiesService],
})
export class CreditInsuranceModule implements OnModuleInit {
    constructor(
        private readonly db: DatabaseService,
        private readonly cronQueue: CronQueueService
    ) {}

    /**
     * The orchestrator lives in `@archaser/cron-jobs`, which depends on
     * billing-connector, so billing-connector cannot import it back without a
     * cycle. Inject it into billing-connector's host port instead. The api's
     * own direct callers (import + connector sync) reach the orchestrator's
     * shared-domain queries through the bind below.
     */
    onModuleInit(): void {
        bindCreditInsurancePrisma(this.db);
        registerArPostIngestOrchestrator((options) =>
            runArPostIngestForCustomers(options)
        );
        registerCreditAsOfBackfillDispatch((accountId: number) =>
            this.cronQueue.enqueueCreditAsOfBackfill({ accountId })
        );
    }
}
