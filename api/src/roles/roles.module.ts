import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { PermissionsModule } from "../permissions/permissions.module";
import { RolesController } from "./roles.controller";
import { RolesService } from "./roles.service";

@Module({
    imports: [AuthModule, DatabaseModule, PermissionsModule],
    controllers: [RolesController],
    providers: [RolesService],
})
export class RolesModule {}
