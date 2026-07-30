import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { CustomerCheckpointService } from "./customer-checkpoint.service";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [CustomersController],
    providers: [CustomersService, CustomerCheckpointService],
    exports: [CustomersService],
})
export class CustomersModule {}
