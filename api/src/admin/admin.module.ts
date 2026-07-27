import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { AdminController } from "./admin.controller";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [AdminController],
})
export class AdminModule {}
