import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import {
    PortalCustomersDomainController,
    PortalDomainController,
} from "./portal.controller";
import { PortalService } from "./portal.service";

@Module({
    imports: [DatabaseModule],
    controllers: [PortalDomainController, PortalCustomersDomainController],
    providers: [PortalService],
    exports: [PortalService],
})
export class PortalModule {}
