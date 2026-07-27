import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { createInsuranceEntityController } from "./create-insurance-entity.controller";
import { CreditDashboardAccessService } from "./credit-dashboard-access.service";
import { CreditInsuranceDomainController } from "./credit-insurance.controller";
import { CreditInsuranceLeavesService } from "./credit-insurance-leaves.service";
import { CreditInsuranceService } from "./credit-insurance.service";
import {
    INSURANCE_ENTITY_TYPES,
    InsuranceEntitiesService,
} from "./insurance-entities.service";

const insuranceEntityControllers = INSURANCE_ENTITY_TYPES.map((t) =>
    createInsuranceEntityController(t)
);

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [
        CreditInsuranceDomainController,
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
export class CreditInsuranceModule {}
