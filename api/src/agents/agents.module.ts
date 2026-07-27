import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { AgentsFollowUpController } from "./agents-follow-up.controller";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [AgentsFollowUpController],
})
export class AgentsModule {}
