import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { ImportDomainController } from "./import.controller";
import { ImportService } from "./import.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [ImportDomainController],
    providers: [ImportService],
    exports: [ImportService],
})
export class ImportModule {}
