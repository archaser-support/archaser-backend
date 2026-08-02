import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { BusinessUnitsController } from "./business-units.controller";
import { BusinessUnitsService } from "./business-units.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [BusinessUnitsController],
    providers: [BusinessUnitsService],
    exports: [BusinessUnitsService],
})
export class BusinessUnitsModule {}
