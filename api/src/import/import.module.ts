import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { ImportDomainController } from "./import.controller";
import { ImportPolicyService } from "./import-policy.service";
import { ImportService } from "./import.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [ImportDomainController],
    providers: [ImportService, ImportPolicyService],
    exports: [ImportService],
})
export class ImportModule {}
