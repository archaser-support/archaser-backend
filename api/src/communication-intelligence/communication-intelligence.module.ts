import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { CommunicationIntelligenceController } from "./communication-intelligence.controller";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [CommunicationIntelligenceController],
})
export class CommunicationIntelligenceModule {}
