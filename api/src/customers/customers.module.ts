import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { CustomerCheckpointService } from "./customer-checkpoint.service";
import { CustomersLeafController } from "./customers-leaf.controller";
import { CustomersController } from "./customers.controller";
import { CustomerPolicyService } from "./customer-policy.service";
import { CustomersService } from "./customers.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [CustomersController, CustomersLeafController],
    providers: [CustomersService, CustomerCheckpointService, CustomerPolicyService],
    exports: [CustomersService],
})
export class CustomersModule {}
